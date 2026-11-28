"""Precomputed feeds (CACHE-1, LOAD-5, Q-P1-17, ADR-0008, P1-W4-S04): recomputed after
feedback, kept as they were when ranking fails, and starter feeds for new guests. One
ranked list of articles per feed (ADR-0058)."""

import json
import random
from datetime import UTC, datetime, timedelta

import pytest

from interval_jobs.adapters.memory import InMemoryStore, StoredUser
from interval_jobs.adapters.memory_queue import InMemoryQueue
from interval_jobs.concepts.graph import parse_concepts
from interval_jobs.concepts.sync import sync_concepts
from interval_jobs.feed import precompute
from interval_jobs.feed.precompute import (
    STARTERS,
    enqueue_recomputes,
    recompute_starter,
    recompute_user_feed,
)
from interval_jobs.ports import (
    Arm,
    EntryFacts,
    FeedEntry,
    RankedEntry,
    Section,
    TagResult,
    Tags,
    UserPreferences,
)

NOW = datetime(2026, 10, 26, 12, tzinfo=UTC)


def recompute_starters(store: InMemoryStore) -> None:
    for topic, level in STARTERS:
        recompute_starter(store, topic, level, None, NOW)


class World:
    def __init__(self) -> None:
        self.store = InMemoryStore()
        sync_concepts(
            self.store,
            parse_concepts(
                "version: 1\nconcepts:\n"
                "  - {slug: indexes, name: Indexes, topic: databases}\n"
                "  - {slug: raft, name: Raft, topic: distributed-systems}\n",
                "c.yaml",
            ),
        )
        self.store.ranking.preferences_by_user["u1"] = UserPreferences(
            topics=["databases"], level="intermediate"
        )
        self.store.users.rows["u1"] = StoredUser("u1", is_anonymous=True)
        self.source = self.store.sources.upsert(
            name="dbblog",
            feed_url="https://dbblog.test/f",
            rights_profile="full_text_internal",
            homepage=None,
        )
        self.store.sources.rows[self.source].topics = ("databases",)

    def item(self, guid: str, day: int, minutes: int = 5) -> int:
        """A full-text article of `minutes`."""
        entry = FeedEntry(
            guid=guid,
            link=f"https://dbblog.test/{guid}",
            title=guid,
            author=None,
            published_at=datetime(2026, 10, day, tzinfo=UTC),
            updated_at=None,
            summary=None,
        )
        item = self.store.items.upsert_from_feed(self.source, entry, keep_excerpt=False)
        # Sections give the article its length: 230 words a minute.
        self.store.items.store_full_text(item, "text")
        self.store.items.replace_sections(item, [Section(guid, 2, None, minutes * 230)])
        return item

    def metadata_only(self, guid: str, day: int) -> int:
        """An article from a source that allows only its title and link (Q-P1-39)."""
        source = self.store.sources.upsert(
            name="meta",
            feed_url="https://meta.test/f",
            rights_profile="metadata_only",
            homepage=None,
        )
        self.store.sources.rows[source].topics = ("databases",)
        entry = FeedEntry(
            guid=guid,
            link=f"https://meta.test/{guid}",
            title=guid,
            author=None,
            published_at=datetime(2026, 10, day, tzinfo=UTC),
            updated_at=None,
            summary=None,
        )
        return self.store.items.upsert_from_feed(source, entry, keep_excerpt=False)

    def feed(self, user: str = "u1") -> list[int]:
        """The user's feed: articles in rank order."""
        return [r.item_id for r in self.store.feed.users.get(user, [])]


def test_a_recompute_after_feedback_reflects_it() -> None:
    w = World()
    newer = w.item("newer", 25)
    older = w.item("older", 20)
    recompute_user_feed(w.store, "u1", None, NOW)
    assert w.feed()[0] == newer  # fresher ranks first
    # Less like this on the newer item: the next recompute moves it down.
    w.store.ranking.feedback.append(("u1", newer, "less_like_this"))
    recompute_user_feed(w.store, "u1", None, NOW)
    assert w.feed() == [older, newer]
    assert w.store.feed.computed["u1"] == NOW


def test_a_ranking_error_keeps_the_last_feed_and_is_counted(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    w = World()
    w.item("kept", 25)
    recompute_user_feed(w.store, "u1", None, NOW)
    before = w.feed()

    def broken() -> dict[str, float]:
        raise RuntimeError("ranking_config unreadable")

    monkeypatch.setattr(w.store.ranking, "config", broken)
    with pytest.raises(RuntimeError):
        recompute_user_feed(w.store, "u1", None, NOW + timedelta(hours=1))
    assert w.feed() == before  # LOAD-5: the stale feed is still served
    assert w.store.feed.computed["u1"] == NOW
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    failures = [line for line in lines if line["msg"] == "feed: recompute failed"]
    assert len(failures) == 1 and failures[0]["user_id"] == "u1"


def test_a_user_without_preferences_gets_an_empty_computed_feed() -> None:
    w = World()
    w.store.users.rows["u2"] = StoredUser("u2", is_anonymous=True)
    w.item("any", 25)
    recompute_user_feed(w.store, "u2", None, NOW)
    assert w.store.feed.users["u2"] == []
    assert w.store.feed.computed["u2"] == NOW


def test_starter_feeds_cover_every_topic_and_level() -> None:
    w = World()
    db_item = w.item("db-post", 25)
    long_item = w.item("db-long", 24, minutes=40)
    recompute_starters(w.store)
    # Every topic (five since ADR-0049), three levels; topics the graph lacks come out
    # empty. One list each, articles of any length (ADR-0058).
    assert len(w.store.feed.starters) == 15
    assert w.store.feed.starters[("software-design", "beginner")] == []
    for level in ("beginner", "intermediate", "advanced"):
        starter = w.store.feed.starters[("databases", level)]
        assert [r.item_id for r in starter] == [db_item, long_item]
        assert w.store.feed.starters[("distributed-systems", level)] == []


def test_the_hourly_pass_queues_each_active_user_once_per_hour() -> None:
    w = World()
    w.store.users.rows["u1"].session_expiries = [NOW + timedelta(days=20)]
    w.store.users.rows["u1"].session_seen = NOW - timedelta(days=2)
    w.store.users.rows["idle"] = StoredUser(
        "idle",
        is_anonymous=False,
        session_expiries=[NOW + timedelta(days=20)],
        session_seen=NOW - timedelta(days=9),
    )
    queue = InMemoryQueue()
    assert enqueue_recomputes(w.store, queue, NOW) == 1
    assert queue.pending("recompute_feed") == 1
    pending = queue.pending_messages("recompute_feed")
    assert pending == [("recompute-u1-2026102612", {"user_id": "u1"})]


def test_a_feed_holds_ranked_articles_in_order() -> None:
    w = World()
    first = w.item("a", 25)
    second = w.item("b", 24)
    recompute_user_feed(w.store, "u1", None, NOW)
    rows = w.store.feed.users["u1"]
    assert [r.item_id for r in rows] == [first, second]
    assert all(isinstance(r, RankedEntry) and r.top_signal for r in rows)


def test_starter_feeds_of_a_topic_dropped_from_the_graph_are_emptied() -> None:
    w = World()
    db_item = w.item("db-post", 25)
    w.store.feed.replace_starter(
        "backend", "beginner", [RankedEntry(db_item, "q", None)]
    )
    recompute_starters(w.store)
    # "backend" isn't in this world's concept graph: its starter is now empty.
    assert w.store.feed.starters[("backend", "beginner")] == []


def test_recompute_due_queues_users_and_refreshes_starters(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    from collections.abc import Generator
    from contextlib import contextmanager
    from dataclasses import dataclass

    from interval_jobs import __main__ as cli

    w = World()
    w.store.users.rows["u1"].session_expiries = [NOW + timedelta(days=20)]
    w.store.users.rows["u1"].session_seen = datetime.now(UTC)
    queue = InMemoryQueue()

    @dataclass
    class FakeServices:
        store: InMemoryStore

    @contextmanager
    def services() -> Generator[FakeServices]:
        yield FakeServices(w.store)

    monkeypatch.setattr(cli, "services", services)
    monkeypatch.setattr(cli, "queue_for_enqueue", lambda: queue)
    cli.main(["recompute-due"])
    result = json.loads(capsys.readouterr().out.splitlines()[-1])
    assert result == {"queued": 1, "starter_feeds": 15}
    assert queue.pending("recompute_feed") == 1


def test_articles_of_any_length_share_one_list_ranked_alike() -> None:
    w = World()
    # ADR-0058: no chips and no time fit; length never moves an article.
    short = w.item("short", 25, minutes=2)
    long = w.item("long", 25, minutes=40)
    recompute_user_feed(w.store, "u1", None, NOW)
    assert w.feed() == [short, long]  # equal scores: lower item id first
    (first, second) = w.store.feed.users["u1"]
    assert first.breakdown is not None and second.breakdown is not None
    assert first.breakdown.values == second.breakdown.values
    assert "time_fit" not in first.breakdown.values


def test_an_article_gone_before_scoring_is_logged_not_silently_dropped(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    w = World()
    w.item("deleted", 25)

    # Deleted between the candidate read and the facts read.
    def none_found(ids: list[int]) -> dict[int, EntryFacts]:
        return {}

    monkeypatch.setattr(w.store.ranking, "article_facts", none_found)
    recompute_user_feed(w.store, "u1", None, NOW)
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert any(line["msg"] == "ranking: candidate gone" for line in lines)
    assert w.feed() == []


def test_an_article_of_unknown_length_is_in_the_feed() -> None:
    w = World()
    unknown = w.metadata_only("meta-post", 25)
    recompute_user_feed(w.store, "u1", None, NOW)
    assert unknown in w.feed()


# ADR-0025: starter notes are the app's own words; nothing is queued to polish them,
# even with a notes model set (there is no polish message to queue any more).
def test_recompute_due_queues_no_note_polish(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    from collections.abc import Generator
    from contextlib import contextmanager
    from dataclasses import dataclass

    from interval_jobs import __main__ as cli

    w = World()
    w.item("db-post", 25)
    queue = InMemoryQueue()

    @dataclass
    class FakeServices:
        store: InMemoryStore

    @contextmanager
    def services() -> Generator[FakeServices]:
        yield FakeServices(w.store)

    monkeypatch.setattr(cli, "services", services)
    monkeypatch.setattr(cli, "queue_for_enqueue", lambda: queue)
    monkeypatch.setenv("NOTES_MODEL", "small-notes")
    cli.main(["recompute-due"])
    out = capsys.readouterr().out
    assert '"starter_feeds": 15' in out


# Exploration (REC-4, P1-W4-S09): a share of slots for topics the user didn't choose
# and sources new to them, by Thompson sampling.
def backend_world(items: int = 10) -> tuple[World, int]:
    w = World()
    sync_concepts(
        w.store,
        parse_concepts(
            "version: 2\nconcepts:\n"
            "  - {slug: indexes, name: Indexes, topic: databases}\n"
            "  - {slug: raft, name: Raft, topic: distributed-systems}\n"
            "  - {slug: rest, name: REST, topic: backend}\n",
            "c.yaml",
        ),
    )
    other = w.store.sources.upsert(
        name="apiblog",
        feed_url="https://apiblog.test/f",
        rights_profile="full_text_internal",
        homepage=None,
    )
    w.store.sources.rows[other].topics = ("backend",)
    for n in range(items):
        entry = FeedEntry(
            guid=f"api-{n}",
            link=f"https://apiblog.test/{n}",
            title=f"api-{n}",
            author=None,
            published_at=datetime(2026, 10, 20, tzinfo=UTC),
            updated_at=None,
            summary=None,
        )
        item = w.store.items.upsert_from_feed(other, entry, keep_excerpt=False)
        w.store.items.store_full_text(item, "text")
        w.store.items.replace_sections(item, [Section("h", 2, None, 5 * 230)])
    for n in range(20):
        w.item(f"db-{n}", 25)
    return w, other


def from_source(w: World, source: int) -> int:
    return sum(1 for item in w.feed() if w.store.items.rows[item].source_id == source)


def test_a_tenth_of_the_slots_explore_topics_the_user_did_not_choose() -> None:
    w, other = backend_world()
    w.store.ranking.config_rows["cap.per_source"] = 10
    recompute_user_feed(w.store, "u1", None, NOW, rng=random.Random(3))
    # 50 entries, 0.1 of them explored: 5, here all from the backend arm.
    assert from_source(w, other) == 5
    # Spread through the feed: never at the top.
    assert w.store.items.rows[w.feed()[0]].source_id != other


def test_explored_entries_keep_the_per_source_cap() -> None:
    w, other = backend_world()  # cap.per_source is 4
    recompute_user_feed(w.store, "u1", None, NOW, rng=random.Random(3))
    sources = [w.store.items.rows[i].source_id for i in w.feed()]
    assert all(sources.count(src) <= 4 for src in set(sources))
    assert from_source(w, other) == 4


def test_exploration_share_zero_explores_nothing() -> None:
    w, other = backend_world()
    w.store.ranking.config_rows["explore.share"] = 0
    recompute_user_feed(w.store, "u1", None, NOW, rng=random.Random(3))
    assert from_source(w, other) == 0


def test_a_hidden_source_or_not_interested_item_is_never_explored() -> None:
    w, other = backend_world()
    w.store.ranking.hidden.add(("u1", other))
    recompute_user_feed(w.store, "u1", None, NOW, rng=random.Random(3))
    assert from_source(w, other) == 0
    w.store.ranking.hidden.clear()
    gone = next(i for i in w.store.items.rows.values() if i.source_id == other).id
    w.store.ranking.feedback.append(("u1", gone, "not_interested"))
    recompute_user_feed(w.store, "u1", None, NOW, rng=random.Random(3))
    assert from_source(w, other) > 0  # still exploring, just never that item
    assert gone not in w.feed()


def test_a_source_the_main_picks_do_not_reach_is_explored(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Two sources on the chosen topic; a feed of 2 with half explored leaves room
    # for one main pick, so the other source is new to the user: a source arm.
    monkeypatch.setattr(precompute, "FEED_LIMIT", 2)
    w = World()
    w.store.ranking.config_rows["explore.share"] = 0.5
    second = w.store.sources.upsert(
        name="dbblog2",
        feed_url="https://dbblog2.test/f",
        rights_profile="full_text_internal",
        homepage=None,
    )
    w.store.sources.rows[second].topics = ("databases",)
    w.item("main-1", 25)
    first, w.source = w.source, second
    w.item("second-1", 20)
    recompute_user_feed(w.store, "u1", None, NOW, rng=random.Random(3))
    sources = [w.store.items.rows[i].source_id for i in w.feed()]
    assert sources == [first, second]


def test_an_unfilled_exploration_slot_goes_back_to_the_main_feed() -> None:
    w = World()
    for n in range(30):
        w.item(f"db-{n}", 25)
    w.store.ranking.config_rows["cap.per_source"] = 50
    w.store.ranking.config_rows["explore.share"] = 0.5
    # 25 main slots, 25 for exploration, nothing to explore (one source, reached; no
    # other topic): the empty slots go back to the main feed.
    recompute_user_feed(w.store, "u1", None, NOW, rng=random.Random(3))
    assert len(w.feed()) == 30


def test_starter_feeds_do_not_explore() -> None:
    w, other = backend_world()
    recompute_starters(w.store)
    starter = w.store.feed.starters[("databases", "beginner")]
    assert all(w.store.items.rows[r.item_id].source_id != other for r in starter)


# P1-W5-S03: an explored entry keeps its arm, so opens and finishes can be counted.
def test_explored_entries_keep_their_arm() -> None:
    w, other = backend_world()
    w.store.ranking.config_rows["cap.per_source"] = 10
    recompute_user_feed(w.store, "u1", None, NOW, rng=random.Random(3))
    rows = w.store.feed.users["u1"]
    explored = [r for r in rows if w.store.items.rows[r.item_id].source_id == other]
    assert explored and all(r.arm == Arm("topic", "backend") for r in explored)
    assert all(
        r.arm is None for r in rows if w.store.items.rows[r.item_id].source_id != other
    )


# ADR-0015 end to end: a goal reaches scoring and the note through the recompute.
def test_a_goal_lifts_its_items_and_names_itself_in_the_note() -> None:
    w = World()
    w.store.ranking.preferences_by_user["u1"] = UserPreferences(
        topics=["databases"],
        level="intermediate",
        goals=["system-design-interviews"],
    )
    # Above topic match, so the goal is the top reason.
    w.store.ranking.config_rows["weight.goal_match"] = 2.0
    item = w.item("idx", 25)
    w.store.tags.save(
        item, TagResult(Tags("intermediate", frozenset({"indexes"})), {}), "m", 1
    )
    recompute_user_feed(w.store, "u1", None, NOW)
    (entry,) = [r for r in w.store.feed.users["u1"] if r.item_id == item]
    assert entry.breakdown is not None
    assert entry.breakdown.values["goal_match"] == 1.0
    assert entry.top_signal == "goal_match"
    # ADR-0027: the goal line names the concept that made the pick.
    assert entry.reasons is not None
    assert "Indexes" in entry.reasons
    assert entry.reason_kinds == ("goal_match",)
    assert entry.difficulty == "intermediate"


# P2-W12-S04 (REC-1, ADR-0015): a connected user's projects reach the feed through the
# recompute: their concepts are candidates, the stack goal's set, and the note's reason.
def test_project_concepts_reach_the_feed_and_its_note() -> None:
    w = World()
    w.store.ranking.preferences_by_user["u1"] = UserPreferences(
        topics=["databases"],
        level="intermediate",
        goals=["stack-i-use"],
    )
    w.store.ranking.config_rows["weight.project_match"] = 2.0
    w.store.ranking.projects["u1"] = {"indexes": (("postgresql", "PostgreSQL"),)}
    w.store.ranking.repositories["u1"] = {"postgresql": ("octo/velox",)}
    item = w.item("idx", 25)
    w.store.tags.save(
        item, TagResult(Tags("intermediate", frozenset({"indexes"})), {}), "m", 1
    )
    recompute_user_feed(w.store, "u1", None, NOW)
    (entry,) = [r for r in w.store.feed.users["u1"] if r.item_id == item]
    assert entry.breakdown is not None
    assert entry.breakdown.values["project_match"] == 1.0
    assert entry.breakdown.values["goal_match"] == 1.0  # the stack goal's set
    assert entry.top_signal == "project_match"
    # The user's own line names their repository (private to them), by short name.
    assert entry.reasons is not None
    assert "velox" in entry.reasons and "Indexes" in entry.reasons
    assert entry.reason_kinds == ("project_match",)


# ADR-0027: a starter feed has no user, so its lines never state a project, a goal or a
# repository.
def test_starter_reasons_state_nothing_personal() -> None:
    w = World()
    w.store.ranking.projects["u1"] = {"indexes": (("postgresql", "PostgreSQL"),)}
    w.store.ranking.repositories["u1"] = {"postgresql": ("octo/velox",)}
    item = w.item("idx", 3)
    w.store.tags.save(
        item, TagResult(Tags("beginner", frozenset({"indexes"})), {}), "m", 1
    )
    recompute_starter(w.store, "databases", "beginner", None, NOW)
    entries = w.store.feed.starters[("databases", "beginner")]
    assert entries
    for entry in entries:
        assert not {"project_match", "goal_match", "explore"} & set(entry.reason_kinds)
        assert entry.difficulty == "beginner"
        assert "octo/velox" not in (entry.reasons or "")
