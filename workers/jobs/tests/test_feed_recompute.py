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
    FeedEntry,
    MomentFacts,
    MomentRow,
    RankedMoment,
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

    def item(self, guid: str, day: int, minutes: int = 5) -> tuple[int, int]:
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
        self.store.moments.replace(
            item, [MomentRow(0, guid, minutes, entry.link, "page_top")]
        )
        return item, self.store.moments.for_item(item)[0].id

    def feed(self, user: str = "u1", chip: BreakLength = "3-8") -> list[int]:
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
    assert all(isinstance(r, RankedMoment) and r.top_signal for r in rows)


def test_starter_feeds_of_a_topic_dropped_from_the_graph_are_emptied() -> None:
    w = World()
    _, db_moment = w.item("db-post", 25)
    w.store.feed.replace_starter(
        "backend", "beginner", "3-8", [RankedMoment(db_moment, "q")]
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


def test_each_chip_holds_only_moments_that_fit_it() -> None:
    w = World()
    _, two = w.item("two", 25, minutes=2)
    _, five = w.item("five", 25, minutes=5)
    _, twelve = w.item("twelve", 25, minutes=12)
    recompute_user_feed(w.store, "u1", None, NOW)
    assert w.feed(chip="1-3") == [two]
    assert set(w.feed(chip="3-8")) == {two, five}
    assert set(w.feed(chip="8-15")) == {two, five, twelve}


def test_each_chip_ranks_with_its_own_time_fit() -> None:
    w = World()
    # Only time fit counts here, so the order shows which break each chip scored for.
    for key in list(w.store.ranking.config_rows):
        if key.startswith("weight.") and key != "weight.time_fit":
            w.store.ranking.config_rows[key] = 0
    w.store.ranking.config_rows["mmr.lambda"] = 1
    _, short = w.item("short", 25, minutes=2)
    _, long = w.item("long", 25, minutes=10)
    recompute_user_feed(w.store, "u1", None, NOW)
    # The long break wants long reads (W4-S03); a 2-minute moment fits it less.
    assert w.feed(chip="8-15") == [long, short]
    assert w.feed(chip="3-8") == [short]


def test_a_moment_gone_before_scoring_is_logged_not_silently_dropped(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    w = World()
    w.item("resegmented", 25)

    # Re-segmented between the candidate read and the facts read.
    def none_found(ids: list[int]) -> dict[int, MomentFacts]:
        return {}

    monkeypatch.setattr(w.store.ranking, "moment_facts", none_found)
    recompute_user_feed(w.store, "u1", None, NOW)
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert any(line["msg"] == "ranking: candidate moment gone" for line in lines)
