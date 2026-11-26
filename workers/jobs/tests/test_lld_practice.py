"""LLD practice progress (ADR-0048, Q-WD-28): the game server's message is checked
against the shape both sides pin (services/game/testdata/practice_judged.json), relayed
from Valkey onto the queue, and kept as the player's best, once per match and sequence
number (LOAD-5). A practice match's result moves no rating and raises no flag."""

import json
import os
import threading
import uuid
from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import psycopg
import pytest
import redis

from interval_db.messages import PracticeJudged
from interval_jobs.adapters.memory import InMemoryLldPractice, InMemoryStore
from interval_jobs.adapters.memory_queue import InMemoryQueue
from interval_jobs.adapters.postgres import PostgresLldPractice, PostgresMatchResults
from interval_jobs.adapters.trafilatura_extractor import TrafilaturaExtractor
from interval_jobs.events.generated import Envelope
from interval_jobs.lld_practice import judged_message, relay_practice
from interval_jobs.match_results import MatchResult
from interval_jobs.pipeline import Pipeline, StageServices
from interval_jobs.ports import Delivery

from .test_db_guards import a_user
from .test_pipeline import web

GOLDEN = Path(__file__).parents[3] / "services" / "game" / "testdata"


def test_the_game_servers_progress_becomes_a_queue_message() -> None:
    message = judged_message((GOLDEN / "practice_judged.json").read_bytes())
    assert message is not None
    assert PracticeJudged.model_validate(message) == PracticeJudged(
        match_id="6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b",
        seq=3,
        played_as="user-1",
        problem_slug="lru-cache",
        points=820,
        visible_passed=1,
        visible_total=1,
        hidden_passed=9,
        hidden_total=10,
        concurrency_passed=1,
        concurrency_total=2,
        extension_passed=2,
        extension_total=3,
        extension_revealed=True,
        language="python",
        judged_at="2026-11-23T12:05:00+00:00",
    )


def test_a_progress_message_before_the_reveal_has_no_extension() -> None:
    body = json.loads((GOLDEN / "practice_judged.json").read_bytes())
    del body["layers"]["extension"]
    message = judged_message(json.dumps(body).encode())
    assert message is not None
    assert message["extension_revealed"] is False
    assert (message["extension_passed"], message["extension_total"]) == (0, 0)


@pytest.mark.parametrize(
    "change",
    [
        {"seq": 0},
        {"points": 1001},
        {"match_id": "not-a-uuid"},
        {"extra": 1},
        {"layers": {"secret": {"passed": 1, "total": 1}}},
        {"layers": {"hidden": {"passed": 3, "total": 2}}},
        {"user": ""},
    ],
)
def test_a_progress_message_that_is_not_one_is_refused(
    change: dict[str, object],
) -> None:
    body = json.loads((GOLDEN / "practice_judged.json").read_bytes())
    body.update(change)
    assert judged_message(json.dumps(body).encode()) is None


def _valkey() -> redis.Redis:
    url = os.environ.get("VALKEY_URL")
    assert url, "VALKEY_URL is not set"
    return redis.Redis.from_url(url)  # pyright: ignore[reportUnknownMemberType]


def test_the_relay_queues_each_progress_once_and_keeps_what_it_cannot_send() -> None:
    client = _valkey()
    prefix = f"test-game-{uuid.uuid4()}:"
    queue = InMemoryQueue()
    stop = threading.Event()
    golden = (GOLDEN / "practice_judged.json").read_bytes()
    left_over = json.loads(golden)
    left_over["seq"] = 2
    try:
        # A crash between the move and the queue left one in the working list.
        client.lpush(f"{prefix}practice:working", json.dumps(left_over).encode())
        client.lpush(f"{prefix}practice", golden, b"junk")
        thread = threading.Thread(
            target=relay_practice, args=(client, queue, stop, prefix, 1)
        )
        thread.start()
        deadline = datetime.now(UTC).timestamp() + 5
        while queue.pending("practice_judged") < 2:
            assert datetime.now(UTC).timestamp() < deadline, "not relayed"
            threading.Event().wait(0.05)
        while client.llen(f"{prefix}practice:refused") < 1:
            assert datetime.now(UTC).timestamp() < deadline, "junk not refused"
            threading.Event().wait(0.05)
        stop.set()
        thread.join()
        sent = sorted(key for key, _ in queue.pending_messages("practice_judged"))
        match_id = left_over["match_id"]
        assert sent == [f"practice-{match_id}-2", f"practice-{match_id}-3"]
        assert client.llen(f"{prefix}practice") == 0
        assert client.llen(f"{prefix}practice:working") == 0
        assert client.lrange(f"{prefix}practice:refused", 0, -1) == [b"junk"]
    finally:
        stop.set()
        for suffix in ("practice", "practice:working", "practice:refused"):
            client.delete(f"{prefix}{suffix}")
        client.close()


SLUG = "practice-results"


def a_practice(conn: psycopg.Connection, user: str, mode: str = "practice") -> str:
    digest = "c" * 64
    conn.execute(
        "insert into lld_problem (slug, title, difficulty, statement, interface, "
        "limits, visible, private_key, content_hash, pool, topic) values (%s, "
        "'A problem', 'easy', '# A', '{}', '{}', '[]', %s, %s, 'practice', 'systems') "
        "on conflict do nothing",
        (SLUG, f"lld/problems/{SLUG}/{digest}.json", digest),
    )
    row = conn.execute(
        "insert into game_match (server_id, mode, problem_slug, unrated) "
        "values (0, %s, %s, true) returning id",
        (mode, SLUG),
    ).fetchone()
    assert row is not None
    conn.execute(
        "insert into game_match_player (match_id, user_id) values (%s, %s)",
        (row[0], user),
    )
    return str(row[0])


def judged(
    match_id: str, user: str, seq: int, points: int, **layers: int
) -> PracticeJudged:
    counts: dict[str, Any] = {
        "visible_passed": 1,
        "visible_total": 1,
        "hidden_passed": 0,
        "hidden_total": 10,
        "concurrency_passed": 0,
        "concurrency_total": 2,
        "extension_passed": 0,
        "extension_total": 0,
        "extension_revealed": False,
    }
    counts.update(layers)
    return PracticeJudged(
        match_id=match_id,
        seq=seq,
        played_as=user,
        problem_slug=SLUG,
        points=points,
        language="python",
        judged_at=f"2026-11-23T12:0{seq}:00+00:00",
        **counts,
    )


def _best(conn: psycopg.Connection, user: str) -> tuple[Any, ...] | None:
    return conn.execute(
        "select points, hidden_passed, hidden_total, language, achieved_at, submits "
        "from lld_practice_best where user_id = %s and problem_slug = %s",
        (user, SLUG),
    ).fetchone()


def test_the_best_is_kept_once_per_submit_and_counts_every_submit(
    conn: psycopg.Connection,
) -> None:
    a_user(conn, "lpa")
    match_id = a_practice(conn, "lpa")
    practice = PostgresLldPractice(conn)
    first = practice.keep(judged(match_id, "lpa", 1, 400, hidden_passed=5))
    assert first is not None
    assert (first.user_id, first.improved, first.is_guest) == ("lpa", True, False)
    assert first.beta_group == "student"
    # A repeat of the same match and sequence number counts nothing (LOAD-5).
    assert practice.keep(judged(match_id, "lpa", 1, 400, hidden_passed=5)) is None
    worse = practice.keep(judged(match_id, "lpa", 2, 100, hidden_passed=1))
    assert worse is not None and worse.improved is False
    best = _best(conn, "lpa")
    assert best is not None
    assert best[:4] == (400, 5, 10, "python")
    assert best[4] == datetime(2026, 11, 23, 12, 1, tzinfo=UTC)
    assert best[5] == 2
    # An equal score keeps the earlier one; a better one replaces it.
    equal = practice.keep(judged(match_id, "lpa", 3, 400, hidden_passed=6))
    assert equal is not None and equal.improved is False
    better = practice.keep(judged(match_id, "lpa", 4, 900, hidden_passed=9))
    assert better is not None and better.improved is True
    assert _best(conn, "lpa") == (
        900,
        9,
        10,
        "python",
        datetime(2026, 11, 23, 12, 4, tzinfo=UTC),
        4,
    )
    # A later session counts from its own first sequence number.
    again = a_practice(conn, "lpa")
    assert practice.keep(judged(again, "lpa", 1, 50)) is not None
    assert _best(conn, "lpa")[5] == 5  # type: ignore[index]


def test_a_player_with_no_beta_group_is_kept_with_none(
    conn: psycopg.Connection,
) -> None:
    # ADR-0056: users who joined after the private beta have no group.
    conn.execute(
        "insert into app_user (id, name, email) values ('lpn', 'n', 'lpn@example.test')"
    )
    match_id = a_practice(conn, "lpn")
    kept = PostgresLldPractice(conn).keep(judged(match_id, "lpn", 1, 300))
    assert kept is not None
    assert kept.beta_group is None


@pytest.mark.parametrize("adapter", ["postgres", "memory"])
def test_each_submit_counts_once_whatever_order_it_arrives_in(
    adapter: str, request: pytest.FixtureRequest
) -> None:
    """LOAD-5: messages can arrive late, out of order and more than once."""
    practice: PostgresLldPractice | InMemoryLldPractice
    if adapter == "postgres":
        conn: psycopg.Connection = request.getfixturevalue("conn")
        a_user(conn, "lpe")
        first, second = a_practice(conn, "lpe"), a_practice(conn, "lpe")
        practice = PostgresLldPractice(conn)

        def best() -> tuple[int, int, str, int]:
            row = _best(conn, "lpe")
            assert row is not None
            return (row[0], row[1], row[4].isoformat(), row[5])

    else:
        first, second = str(uuid.uuid4()), str(uuid.uuid4())
        memory = InMemoryLldPractice()
        memory.players[(first, "lpe")] = memory.players[(second, "lpe")] = "lpe"
        practice = memory

        def best() -> tuple[int, int, str, int]:
            kept = memory.bests[("lpe", SLUG)]
            return (
                kept.points,
                kept.hidden_passed,
                kept.judged_at,
                memory.submits[("lpe", SLUG)],
            )

    assert practice.keep(judged(first, "lpe", 1, 300, hidden_passed=3)) is not None
    assert practice.keep(judged(second, "lpe", 1, 200, hidden_passed=2)) is not None
    # A repeat from the earlier match, after the newer one, counts nothing.
    assert practice.keep(judged(first, "lpe", 1, 300, hidden_passed=3)) is None
    assert best() == (300, 3, "2026-11-23T12:01:00+00:00", 2)
    # A lower sequence number arriving after a higher one still counts, and its
    # better score with all of its layers becomes the best.
    assert practice.keep(judged(first, "lpe", 3, 100, hidden_passed=1)) is not None
    late = practice.keep(judged(first, "lpe", 2, 700, hidden_passed=7))
    assert late is not None and late.improved is True
    assert best() == (700, 7, "2026-11-23T12:02:00+00:00", 4)
    assert practice.keep(judged(first, "lpe", 2, 700, hidden_passed=7)) is None
    assert best()[3] == 4


def test_the_stage_says_each_submit_once_whatever_order_it_arrives_in() -> None:
    store = InMemoryStore()
    sink = RecordingSink()

    @contextmanager
    def unit() -> Generator[StageServices]:
        yield StageServices(store, web(), TrafilaturaExtractor())

    handler = Pipeline(unit, InMemoryQueue(), events=sink).handlers()["practice_judged"]
    first, second = str(uuid.uuid4()), str(uuid.uuid4())
    store.lld_practice.players[(first, "u1")] = "u1"
    store.lld_practice.players[(second, "u1")] = "u1"
    for match_id, seq, points in [
        (first, 1, 300),
        (second, 1, 200),
        (first, 1, 300),
        (first, 3, 100),
        (first, 2, 700),
        (first, 2, 700),
    ]:
        key = f"practice-{match_id}-{seq}"
        handler(judged(match_id, "u1", seq, points), Delivery(1, key))
    assert [
        (e.props.model_dump()["points"], e.props.model_dump()["improved"])
        for e in sink.events
    ] == [(300, True), (200, False), (100, False), (700, True)]


def test_progress_for_a_match_that_is_not_the_players_practice_is_dropped(
    conn: psycopg.Connection,
) -> None:
    a_user(conn, "lpb")
    a_user(conn, "lpc")
    practice = PostgresLldPractice(conn)
    match_id = a_practice(conn, "lpb")
    assert practice.keep(judged(match_id, "lpc", 1, 400)) is None
    battle = a_practice(conn, "lpb", mode="battle")
    conn.execute("update game_match set unrated = false where id = %s", (battle,))
    assert practice.keep(judged(battle, "lpb", 1, 400)) is None
    assert _best(conn, "lpb") is None


def test_a_practice_result_closes_its_match_and_writes_nothing_else(
    conn: psycopg.Connection,
) -> None:
    """ADR-0048: ratings, places, fair play and the AI code review key on battles."""
    a_user(conn, "lpd")
    match_id = a_practice(conn, "lpd")
    result = MatchResult.model_validate(
        {
            "match_id": match_id,
            "finished_at": "2026-11-23T13:00:00Z",
            "outcome": "finished",
            "winner": "lpd",
            "players": [
                {
                    "played_as": "lpd",
                    "total": 1000,
                    "time_ms": 600_000,
                    "abandoned": False,
                    "answers": [],
                    "signals": [
                        {"kind": "paste", "round": 1, "ms": None, "chars": 900}
                    ],
                }
            ],
        }
    )
    results = PostgresMatchResults(conn)
    assert results.record(result) is True
    assert results.record(result) is False
    assert conn.execute(
        "select outcome, finished_at is not null from game_match where id = %s",
        (match_id,),
    ).fetchone() == ("finished", True)
    assert conn.execute(
        "select total, signals from game_match_player where match_id = %s",
        (match_id,),
    ).fetchone() == (None, None)
    for table in (
        "fair_play_flag",
        "battle_rating_history",
        "room_rating_history",
        "rating_history",
        "quiz_attempt",
        "ghost_run",
    ):
        assert conn.execute(
            f"select count(*) from {table} where match_id = %s", (match_id,)
        ).fetchone() == (0,), table


class RecordingSink:
    def __init__(self) -> None:
        self.events: list[Envelope] = []

    def write(self, batch: list[Envelope]) -> list[Envelope]:
        self.events.extend(batch)
        return []


def test_the_stage_keeps_the_best_and_says_so_once() -> None:
    store = InMemoryStore()
    sink = RecordingSink()

    @contextmanager
    def unit() -> Generator[StageServices]:
        yield StageServices(store, web(), TrafilaturaExtractor())

    handler = Pipeline(unit, InMemoryQueue(), events=sink).handlers()["practice_judged"]
    match_id = str(uuid.uuid4())
    store.lld_practice.players[(match_id, "u1")] = "u1"
    delivery = Delivery(attempt=1, idempotency_key=f"practice-{match_id}-1")
    message = judged(
        match_id,
        "u1",
        1,
        820,
        hidden_passed=9,
        extension_total=3,
        extension_passed=2,
        extension_revealed=True,
    )
    handler(message, delivery)
    handler(message, delivery)  # a redelivery: counted once, said once
    assert store.lld_practice.bests[("u1", SLUG)].points == 820
    assert [(e.name, e.user_id, e.source) for e in sink.events] == [
        ("lld_practice_submitted", "u1", "jobs")
    ]
    assert sink.events[0].props.model_dump() == {
        "problem_slug": SLUG,
        "points": 820,
        "hidden_passed": 9,
        "hidden_total": 10,
        "extension_revealed": True,
        "improved": True,
    }
