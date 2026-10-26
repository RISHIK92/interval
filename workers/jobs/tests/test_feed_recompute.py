"""Precomputed feeds (CACHE-1, LOAD-5, Q-P1-17, ADR-0008, P1-W4-S04): recomputed after
feedback, kept as they were when ranking fails, and starter feeds for new guests. One
feed per time chip (Q-P1-16, P1-W4-S05)."""

import json
from datetime import UTC, datetime, timedelta

import pytest

from interval_db.generated import BreakLength
from interval_jobs.adapters.memory import InMemoryStore, StoredUser
from interval_jobs.adapters.memory_queue import InMemoryQueue
from interval_jobs.concepts.graph import parse_concepts
from interval_jobs.concepts.sync import sync_concepts
from interval_jobs.feed.precompute import (
    enqueue_recomputes,
    recompute_starters,
    recompute_user_feed,
)
from interval_jobs.ports import (
    CandidateArticle,
    EntryFacts,
    FeedEntry,
    MomentRow,
    RankedEntry,
    Section,
    UserPreferences,
)

NOW = datetime(2026, 10, 26, 12, tzinfo=UTC)


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
            topics=["databases"], level="intermediate", break_length="3-8"
        )
        self.store.users.rows["u1"] = StoredUser("u1", is_anonymous=True)
        self.source = self.store.sources.upsert(
            name="dbblog",
            feed_url="https://dbblog.test/f",
            rights_profile="full_text_internal",
            homepage=None,
        )
        self.store.sources.set_moments_enabled(self.source, True)
        self.store.sources.rows[self.source].topics = ("databases",)

    def item(
        self, guid: str, day: int, minutes: int = 5, parts: list[int] | None = None
    ) -> tuple[int, int]:
        """A full-text article with one moment per part (default: one of `minutes`);
        returns the item and its first moment."""
        parts = parts or [minutes]
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
        # Sections give the whole article its length: 230 words a minute.
        self.store.items.store_full_text(item, "text")
        self.store.items.replace_sections(
            item,
            [Section(f"{guid} {i}", 2, None, n * 230) for i, n in enumerate(parts)],
        )
        self.store.moments.replace(
            item,
            [
                MomentRow(i, f"{guid} {i}", n, f"{entry.link}#{i}", "anchor")
                for i, n in enumerate(parts)
            ],
        )
        return item, self.store.moments.for_item(item)[0].id

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

    def entries(
        self, chip: BreakLength, user: str = "u1"
    ) -> list[tuple[int, int | None]]:
        """(item, moment) in rank order; no moment means the whole article."""
        rows = self.store.feed.users.get(user, {}).get(chip, [])
        return [(r.item_id, r.moment_id) for r in rows]

    def feed(self, user: str = "u1", chip: BreakLength = "3-8") -> list[int | None]:
        return [r.moment_id for r in self.store.feed.users.get(user, {}).get(chip, [])]


def test_a_recompute_after_feedback_reflects_it() -> None:
    w = World()
    newer_item, newer = w.item("newer", 25)
    _, older = w.item("older", 20)
    recompute_user_feed(w.store, "u1", None, NOW)
    assert w.feed()[0] == newer  # fresher ranks first
    # Less like this on the newer item: the next recompute moves it down.
    w.store.ranking.feedback.append(("u1", newer_item, "less_like_this"))
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
    assert w.store.feed.users["u2"] == {"1-3": [], "3-8": [], "8-15": []}
    assert w.store.feed.computed["u2"] == NOW


def test_starter_feeds_cover_every_topic_level_and_chip() -> None:
    w = World()
    _, db_moment = w.item("db-post", 25)
    written = recompute_starters(w.store, None, NOW)
    # Every topic, three levels, three chips (topics the graph lacks come out empty).
    assert written == 36
    for level in ("beginner", "intermediate", "advanced"):
        starter = w.store.feed.starters[("databases", level, "3-8")]
        assert [r.moment_id for r in starter] == [db_moment]
        assert w.store.feed.starters[("databases", level, "1-3")] == []  # 5 min
        assert w.store.feed.starters[("distributed-systems", level, "3-8")] == []


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


def test_a_feed_holds_ranked_moments_in_order() -> None:
    w = World()
    _, first = w.item("a", 25)
    _, second = w.item("b", 24)
    recompute_user_feed(w.store, "u1", None, NOW)
    rows = w.store.feed.users["u1"]["3-8"]
    assert [r.moment_id for r in rows] == [first, second]
    assert all(isinstance(r, RankedEntry) and r.top_signal for r in rows)


def test_starter_feeds_of_a_topic_dropped_from_the_graph_are_emptied() -> None:
    w = World()
    db_item, db_moment = w.item("db-post", 25)
    w.store.feed.replace_starter(
        "backend", "beginner", "3-8", [RankedEntry(db_item, db_moment, "q")]
    )
    recompute_starters(w.store, None, NOW)
    # "backend" isn't in this world's concept graph: its starter is now empty.
    assert w.store.feed.starters[("backend", "beginner", "3-8")] == []


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
    assert result == {"queued": 1, "starter_feeds": 36}
    assert queue.pending("recompute_feed") == 1


def test_short_chips_hold_moments_that_fit_and_8_15_whole_articles_that_fit() -> None:
    w = World()
    two_item, two = w.item("two", 25, minutes=2)
    five_item, five = w.item("five", 25, minutes=5)
    twelve_item, _ = w.item("twelve", 25, minutes=12)
    recompute_user_feed(w.store, "u1", None, NOW)
    assert w.entries("1-3") == [(two_item, two)]
    assert set(w.entries("3-8")) == {(two_item, two), (five_item, five)}
    # Every article fits in 15 minutes: offered whole, not as its moments (owner).
    assert set(w.entries("8-15")) == {
        (two_item, None),
        (five_item, None),
        (twelve_item, None),
    }


def test_each_chip_ranks_with_its_own_time_fit() -> None:
    w = World()
    # Only time fit counts here, so the order shows which break each chip scored for.
    for key in list(w.store.ranking.config_rows):
        if key.startswith("weight.") and key != "weight.time_fit":
            w.store.ranking.config_rows[key] = 0
    w.store.ranking.config_rows["mmr.lambda"] = 1
    short_item, short = w.item("short", 25, minutes=2)
    long_item, _ = w.item("long", 25, minutes=10)
    recompute_user_feed(w.store, "u1", None, NOW)
    # The long break wants long reads (W4-S03); a 2-minute article fits it less.
    assert w.entries("8-15") == [(long_item, None), (short_item, None)]
    assert w.entries("3-8") == [(short_item, short)]


def test_a_moment_gone_before_scoring_is_logged_not_silently_dropped(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    w = World()
    w.item("resegmented", 25)

    # Re-segmented between the candidate read and the facts read.
    def none_found(ids: list[int]) -> dict[int, EntryFacts]:
        return {}

    monkeypatch.setattr(w.store.ranking, "moment_facts", none_found)
    recompute_user_feed(w.store, "u1", None, NOW)
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert any(line["msg"] == "ranking: candidate gone" for line in lines)


def test_an_article_over_15_minutes_shows_whole_and_as_its_moments() -> None:
    w = World()
    # Owner, 2026-10-26: too long to fit, so ranked lower, and its moments show too.
    w.store.ranking.config_rows["cap.per_source"] = 10  # one source in this world
    long_item, _ = w.item("long", 25, parts=[8, 7, 6, 16])
    fits_item, _ = w.item("fits", 25, minutes=12)
    recompute_user_feed(w.store, "u1", None, NOW)
    *fitting, too_long = [m.id for m in w.store.moments.for_item(long_item)]
    entries = w.entries("8-15")
    assert (long_item, None) in entries and (fits_item, None) in entries
    assert {(long_item, m) for m in fitting} <= set(entries)
    assert (long_item, too_long) not in entries  # a 16-minute moment fits no chip
    assert entries.index((fits_item, None)) < entries.index((long_item, None))


def test_an_article_of_unknown_length_appears_only_under_8_15() -> None:
    w = World()
    unknown = w.metadata_only("meta-post", 25)
    recompute_user_feed(w.store, "u1", None, NOW)
    assert (unknown, None) in w.entries("8-15")
    for chip in ("1-3", "3-8"):
        assert all(item != unknown for item, _ in w.entries(chip))
    assert w.store.moments.for_item(unknown) == []


def test_starter_feeds_hold_whole_articles_under_8_15() -> None:
    w = World()
    item, moment = w.item("db-post", 25)
    recompute_starters(w.store, None, NOW)
    starter = w.store.feed.starters[("databases", "beginner", "8-15")]
    assert [(r.item_id, r.moment_id) for r in starter] == [(item, None)]
    short = w.store.feed.starters[("databases", "beginner", "3-8")]
    assert [(r.item_id, r.moment_id) for r in short] == [(item, moment)]


def test_an_article_that_fits_stays_whole_when_only_its_moments_were_found(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A moment can be found without its article: by similarity (off-topic), or past
    # the article candidates' limit. The article is still offered whole under 8-15.
    w = World()
    item, moment = w.item("found-by-moment", 25, minutes=6)

    def none_found(*_args: object, **_kwargs: object) -> list[CandidateArticle]:
        return []

    monkeypatch.setattr(w.store.ranking, "topic_articles", none_found)
    recompute_user_feed(w.store, "u1", None, NOW)
    assert w.entries("8-15") == [(item, None)]
    assert w.entries("3-8") == [(item, moment)]
