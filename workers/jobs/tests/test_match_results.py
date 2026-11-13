"""Live match results (P3-W15-S05, ADR-0033): the game server's result is checked
against the shape both sides pin (services/game/testdata/match_finished.json), relayed
from Valkey onto the queue, and recorded once."""

import json
import os
import threading
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import psycopg
import pytest
import redis

from interval_jobs.adapters.memory_queue import InMemoryQueue
from interval_jobs.adapters.postgres import PostgresMatchResults
from interval_jobs.match_results import (
    FairPlaySignal,
    MatchResult,
    parse_result,
    relay,
)
from interval_jobs.ratings import Glicko, update

from .test_db_guards import a_user

GOLDEN = Path(__file__).parents[3] / "services" / "game" / "testdata"


def test_the_game_servers_result_is_a_result() -> None:
    raw = (GOLDEN / "match_finished.json").read_bytes()
    result = parse_result(raw)
    assert result is not None
    assert result.outcome == "finished"
    assert result.winner == "user-1"
    assert [p.played_as for p in result.players] == ["user-1", "user-2"]
    assert result.players[0].answers[0].ms == 2950


@pytest.mark.parametrize(
    "change",
    [
        {"outcome": "won"},
        {"players": []},
        {"match_id": "not-a-uuid"},
        {"extra": 1},
        {"winner": ""},
    ],
)
def test_a_result_that_is_not_one_is_refused(change: dict[str, object]) -> None:
    body = json.loads((GOLDEN / "match_finished.json").read_bytes())
    body.update(change)
    assert parse_result(json.dumps(body).encode()) is None


def test_a_sprint_result_holds_thirty_answers_and_no_more() -> None:
    """P3-W16-S04 (Q-P3-23): a live sprint plays up to 30 questions."""
    body = json.loads((GOLDEN / "match_finished.json").read_bytes())
    answer = {"round": 1, "question_id": 7, "choice": 0, "correct": True, "ms": 900}
    body["players"][0]["answers"] = [{**answer, "round": n} for n in range(1, 31)]
    assert parse_result(json.dumps(body).encode()) is not None
    body["players"][0]["answers"].append({**answer, "round": 31})
    assert parse_result(json.dumps(body).encode()) is None


def _valkey() -> redis.Redis:
    url = os.environ.get("VALKEY_URL")
    assert url, "VALKEY_URL is not set"
    return redis.Redis.from_url(url)  # pyright: ignore[reportUnknownMemberType]


def test_the_relay_queues_each_id_once_and_keeps_what_it_cannot_send() -> None:
    client = _valkey()
    prefix = f"test-game-{uuid.uuid4()}:"
    queue = InMemoryQueue()
    stop = threading.Event()
    try:
        left_over, fresh = str(uuid.uuid4()), str(uuid.uuid4())
        # A crash between the move and the queue left one in the working list.
        client.lpush(f"{prefix}results:working", left_over.encode())
        client.lpush(f"{prefix}results", fresh.encode(), b"junk")
        thread = threading.Thread(target=relay, args=(client, queue, stop, prefix, 1))
        thread.start()
        deadline = datetime.now(UTC).timestamp() + 5
        while queue.pending("match_finished") < 2:
            assert datetime.now(UTC).timestamp() < deadline, "not relayed"
            threading.Event().wait(0.05)
        while client.llen(f"{prefix}results:refused") < 1:
            assert datetime.now(UTC).timestamp() < deadline, "junk not refused"
            threading.Event().wait(0.05)
        stop.set()
        thread.join()
        sent = sorted(
            str(message["match_id"])
            for _, message in queue.pending_messages("match_finished")
        )
        assert sent == sorted([left_over, fresh])
        assert client.llen(f"{prefix}results") == 0
        assert client.llen(f"{prefix}results:working") == 0
        assert client.lrange(f"{prefix}results:refused", 0, -1) == [b"junk"]
    finally:
        stop.set()
        for suffix in ("results", "results:working", "results:refused"):
            client.delete(f"{prefix}{suffix}")
        client.close()


def _match(conn: psycopg.Connection, players: list[tuple[str, str | None]]) -> str:
    row = conn.execute(
        "insert into game_match (server_id) values (0) returning id"
    ).fetchone()
    assert row is not None
    for user_id, played_as in players:
        conn.execute(
            "insert into game_match_player (match_id, user_id, played_as) "
            "values (%s, %s, %s)",
            (row[0], user_id, played_as),
        )
    return str(row[0])


def _question(conn: psycopg.Connection) -> int:
    row = conn.execute(
        "insert into question (kind, ordinal, stem, answer, unit, citation, "
        "source_url, source_title, status) values ('estimate', 0, 'How many?', 300, "
        "'ms', 'about 300 ms', 'https://docs.example.test/live', 'X', 'live') "
        "returning id"
    ).fetchone()
    assert row is not None
    return int(row[0])


def _result(match_id: str, outcome: str, question: int) -> MatchResult:
    return MatchResult.model_validate(
        {
            "match_id": match_id,
            "finished_at": "2026-11-02T12:05:00Z",
            "outcome": outcome,
            "winner": "guest-1" if outcome == "finished" else None,
            "players": [
                {
                    "played_as": "guest-1",
                    "total": 140,
                    "time_ms": 2950,
                    "abandoned": False,
                    "answers": [
                        {
                            "round": 1,
                            "question_id": question,
                            "choice": 0,
                            "correct": True,
                            "ms": 2950,
                        }
                    ],
                },
                {
                    "played_as": "lrb",
                    "total": 0,
                    "time_ms": 15000,
                    "abandoned": outcome == "abandoned",
                    # Two rounds unanswered: no evidence, and no open rows.
                    "answers": [
                        {
                            "round": n,
                            "question_id": question,
                            "choice": None,
                            "correct": None,
                            "ms": None,
                        }
                        for n in (1, 2)
                    ],
                },
            ],
        }
    )


def test_a_result_is_recorded_once_with_each_players_answers(
    conn: psycopg.Connection,
) -> None:
    a_user(conn, "lra")
    a_user(conn, "lrb")
    question = _question(conn)
    # lr-a signed up mid-match as guest-1 (Q-P3-21): it plays on as that id.
    match_id = _match(conn, [("lra", "guest-1"), ("lrb", None)])
    results = PostgresMatchResults(conn)
    assert results.record(_result(match_id, "finished", question)) is True
    assert results.record(_result(match_id, "finished", question)) is False

    match = conn.execute(
        "select outcome, winner_id, finished_at is not null from game_match "
        "where id = %s",
        (match_id,),
    ).fetchone()
    assert match == ("finished", "lra", True)
    players = conn.execute(
        "select user_id, total, time_ms, abandoned from game_match_player "
        "where match_id = %s order by user_id",
        (match_id,),
    ).fetchall()
    assert players == [("lra", 140, 2950, False), ("lrb", 0, 15000, False)]
    answers = conn.execute(
        "select a.user_id, qa.chosen, qa.correct, qa.answered_at is not null, "
        "a.evidence_applied_at "
        "from quiz_attempt a join quiz_answer qa on qa.attempt_id = a.id "
        "where a.match_id = %s order by a.user_id",
        (match_id,),
    ).fetchall()
    # Evidence still to apply (the web app does that, ARCH-2); answered rounds only,
    # stamped at the match's end.
    assert answers == [("lra", 0, True, True, None)]
    assert conn.execute(
        "select count(*) from quiz_attempt where match_id = %s", (match_id,)
    ).fetchone() == (2,)
    stamped = conn.execute(
        "select qa.answered_at from quiz_answer qa join quiz_attempt a "
        "on a.id = qa.attempt_id where a.match_id = %s",
        (match_id,),
    ).fetchone()
    assert stamped is not None and stamped[0] == datetime(
        2026, 11, 2, 12, 5, tzinfo=UTC
    )


@pytest.mark.parametrize("outcome", ["cancelled", "void"])
def test_a_match_without_a_result_keeps_no_answers(
    conn: psycopg.Connection, outcome: str
) -> None:
    a_user(conn, "lra")
    a_user(conn, "lrb")
    question = _question(conn)
    match_id = _match(conn, [("lra", "guest-1"), ("lrb", None)])
    assert PostgresMatchResults(conn).record(_result(match_id, outcome, question))
    assert conn.execute(
        "select outcome, winner_id from game_match where id = %s", (match_id,)
    ).fetchone() == (outcome, None)
    assert conn.execute(
        "select count(*) from quiz_attempt where match_id = %s", (match_id,)
    ).fetchone() == (0,)


class _Blinking:
    """Valkey that drops the first call, then has nothing to give."""

    def __init__(self, stop: threading.Event) -> None:
        self.calls = 0
        self.stop = stop

    def lrange(self, name: str, start: int, end: int) -> list[bytes]:
        self.calls += 1
        if self.calls == 1:
            raise ConnectionError("reset")
        return []

    def blmove(
        self, first_list: str, second_list: str, timeout: int, src: str, dest: str
    ) -> bytes | None:
        self.stop.set()
        return None

    def lrem(self, name: str, count: int, value: bytes) -> int:
        return 0

    def lpush(self, name: str, *values: bytes) -> int:
        return 0

    def get(self, name: str) -> bytes | None:
        return None


def test_the_relay_waits_out_valkey_going_away() -> None:
    stop = threading.Event()
    flaky = _Blinking(stop)
    waits: list[float] = []
    real_wait = stop.wait

    def wait(timeout: float | None = None) -> bool:
        waits.append(timeout or 0)
        return real_wait(0)

    stop.wait = wait  # type: ignore[method-assign]
    relay(flaky, InMemoryQueue(), stop)
    # The reset was waited out, then it carried on (and was stopped).
    assert flaky.calls == 2
    assert waits == [5]


# P3-W16-S01 (MATCH-1, ADR-0034): rated once with the result, Glicko-2 from 1500/350.
def _ratings(conn: psycopg.Connection) -> dict[str, tuple[float, int]]:
    return {
        str(user): (float(rating), int(games))
        for user, rating, games in conn.execute(
            "select user_id, rating, games from player_rating "
            "where user_id in ('lra', 'lrb')"
        ).fetchall()
    }


def _scores(
    result: MatchResult, winner: str | None, abandoned: set[str]
) -> MatchResult:
    return result.model_copy(
        update={
            "winner": winner,
            "players": [
                p.model_copy(update={"abandoned": p.played_as in abandoned})
                for p in result.players
            ],
        }
    )


def test_a_finished_match_is_rated_once(conn: psycopg.Connection) -> None:
    a_user(conn, "lra")
    a_user(conn, "lrb")
    question = _question(conn)
    match_id = _match(conn, [("lra", "guest-1"), ("lrb", None)])
    result = _result(match_id, "finished", question)  # guest-1 (lra) wins
    results = PostgresMatchResults(conn)
    assert results.record(result)
    rated = _ratings(conn)
    assert rated["lra"][0] > 1500 > rated["lrb"][0]
    assert rated["lra"][0] - 1500 == pytest.approx(1500 - rated["lrb"][0])
    assert rated["lra"][1] == rated["lrb"][1] == 1
    history = conn.execute(
        "select user_id, rating_before, score from rating_history "
        "where match_id = %s order by user_id",
        (match_id,),
    ).fetchall()
    assert history == [("lra", 1500.0, 1.0), ("lrb", 1500.0, 0.0)]
    assert conn.execute(
        "select rated_at is not null from game_match where id = %s", (match_id,)
    ).fetchone() == (True,)
    # Recorded again: not rated again.
    assert not results.record(result)
    assert _ratings(conn) == rated


@pytest.mark.parametrize(
    ("outcome", "winner", "abandoned", "up", "down"),
    [
        ("finished", None, set[str](), set[str](), set[str]()),  # a tie: no movement
        ("abandoned", "lrb", {"guest-1"}, {"lrb"}, {"lra"}),  # the leaver loses
        ("abandoned", None, {"guest-1", "lrb"}, set[str](), {"lra", "lrb"}),
    ],
)
def test_ties_and_abandons_rate_as_the_owner_said(
    conn: psycopg.Connection,
    outcome: str,
    winner: str | None,
    abandoned: set[str],
    up: set[str],
    down: set[str],
) -> None:
    a_user(conn, "lra")
    a_user(conn, "lrb")
    question = _question(conn)
    match_id = _match(conn, [("lra", "guest-1"), ("lrb", None)])
    result = _scores(_result(match_id, outcome, question), winner, abandoned)
    assert PostgresMatchResults(conn).record(result)
    rated = _ratings(conn)
    for user in ("lra", "lrb"):
        if user in up:
            assert rated[user][0] > 1500
        elif user in down:
            assert rated[user][0] < 1500
        else:
            assert rated[user][0] == pytest.approx(1500)


@pytest.mark.parametrize("outcome", ["cancelled", "void"])
def test_a_match_without_a_result_is_unrated(
    conn: psycopg.Connection, outcome: str
) -> None:
    a_user(conn, "lra")
    a_user(conn, "lrb")
    question = _question(conn)
    match_id = _match(conn, [("lra", "guest-1"), ("lrb", None)])
    assert PostgresMatchResults(conn).record(_result(match_id, outcome, question))
    assert _ratings(conn) == {}
    assert conn.execute(
        "select rated_at from game_match where id = %s", (match_id,)
    ).fetchone() == (None,)


def test_a_second_match_starts_from_the_stored_rating(conn: psycopg.Connection) -> None:
    a_user(conn, "lra")
    a_user(conn, "lrb")
    question = _question(conn)
    results = PostgresMatchResults(conn)
    first = _match(conn, [("lra", "guest-1"), ("lrb", None)])
    assert results.record(_result(first, "finished", question))
    after_first = conn.execute(
        "select rating_after from rating_history "
        "where match_id = %s and user_id = 'lra'",
        (first,),
    ).fetchone()
    second = _match(conn, [("lra", "guest-1"), ("lrb", None)])
    assert results.record(_result(second, "finished", question))
    row = conn.execute(
        "select rating_before from rating_history "
        "where match_id = %s and user_id = 'lra'",
        (second,),
    ).fetchone()
    assert after_first is not None and row == after_first
    assert _ratings(conn)["lra"][1] == 2


def test_a_guest_against_its_own_account_is_unrated(conn: psycopg.Connection) -> None:
    # The guest signed up into its opponent's account: the merge kept only the
    # account's own seat, so the result's guest seat maps to no one left to rate.
    a_user(conn, "lrb")
    question = _question(conn)
    match_id = _match(conn, [("lrb", None)])
    assert PostgresMatchResults(conn).record(_result(match_id, "finished", question))
    assert _ratings(conn) == {}
    assert conn.execute(
        "select rated_at from game_match where id = %s", (match_id,)
    ).fetchone() == (None,)


def test_abandoned_with_nobody_leaving_is_unrated(conn: psycopg.Connection) -> None:
    a_user(conn, "lra")
    a_user(conn, "lrb")
    question = _question(conn)
    match_id = _match(conn, [("lra", "guest-1"), ("lrb", None)])
    result = _scores(_result(match_id, "abandoned", question), None, set())
    assert PostgresMatchResults(conn).record(result)
    assert _ratings(conn) == {}


# P3-W17-S01 (BOT-1, BOT-4, Q-P3-25; owner, 2026-11-03): each human side of a finished
# live match is kept as a ghost run (ids and timings only), and a match against a ghost
# moves the human's rating half as much.
def _runs(conn: psycopg.Connection, match_id: str) -> list[tuple[Any, ...]]:
    return conn.execute(
        "select user_id, mode, rating, rd, volatility, answers from ghost_run "
        "where match_id = %s order by user_id",
        (match_id,),
    ).fetchall()


def test_each_finished_human_side_is_kept_as_a_run(conn: psycopg.Connection) -> None:
    a_user(conn, "gra")
    a_user(conn, "grb")
    question = _question(conn)
    match_id = _match(conn, [("gra", "guest-1"), ("grb", None)])
    conn.execute("update game_match set mode = 'sprint' where id = %s", (match_id,))
    assert PostgresMatchResults(conn).record(_result(match_id, "finished", question))
    # The account it plays as now; the rating before the match; ids and times only.
    # grb answered nothing: no run.
    assert _runs(conn, match_id) == [
        (
            "gra",
            "sprint",
            1500.0,
            350.0,
            0.06,
            [{"n": 1, "question_id": question, "choice": 0, "ms": 2950}],
        )
    ]


@pytest.mark.parametrize("outcome", ["abandoned", "cancelled", "void"])
def test_a_match_not_finished_keeps_no_runs(
    conn: psycopg.Connection, outcome: str
) -> None:
    a_user(conn, "gra")
    a_user(conn, "grb")
    question = _question(conn)
    match_id = _match(conn, [("gra", "guest-1"), ("grb", None)])
    result = _result(match_id, outcome, question)
    if outcome == "abandoned":
        result = result.model_copy(
            update={
                "players": [
                    p.model_copy(update={"abandoned": p.played_as == "grb"})
                    for p in result.players
                ]
            }
        )
    PostgresMatchResults(conn).record(result)
    assert _runs(conn, match_id) == []


def _ghost_match(conn: psycopg.Connection, question: int) -> tuple[str, int]:
    """A ghost run of grb's at 1700/50, and a match of gra's against it."""
    source = _match(conn, [("grb", None)])
    row = conn.execute(
        "insert into ghost_run (match_id, user_id, mode, rating, rd, volatility,"
        " answers) values (%s, 'grb', 'fastest_finger', 1700, 50, 0.06, %s)"
        " returning id",
        (source, f'[{{"n": 1, "question_id": {question}, "choice": 0, "ms": 4000}}]'),
    ).fetchone()
    assert row is not None
    match_id = _match(conn, [("gra", None)])
    # As the web app makes it: the run, and its seat and Glicko kept with the match.
    conn.execute(
        "update game_match set ghost_run_id = %s, replay_seat = %s, replay_rating ="
        " 1700, replay_rd = 50, replay_volatility = 0.06 where id = %s",
        (row[0], f"ghost:{row[0]}", match_id),
    )
    return match_id, int(row[0])


def test_a_ghost_match_moves_the_human_half_as_much(
    conn: psycopg.Connection, capsys: pytest.CaptureFixture[str]
) -> None:
    a_user(conn, "gra")
    a_user(conn, "grb")
    question = _question(conn)
    match_id, run = _ghost_match(conn, question)
    ghost = f"ghost:{run}"
    result = MatchResult.model_validate(
        {
            "match_id": match_id,
            "finished_at": "2026-11-02T12:05:00Z",
            "outcome": "finished",
            "winner": "gra",
            "players": [
                {
                    "played_as": "gra",
                    "total": 1,
                    "time_ms": 2000,
                    "abandoned": False,
                    "answers": [
                        {
                            "round": 1,
                            "question_id": question,
                            "choice": 0,
                            "correct": True,
                            "ms": 2000,
                        }
                    ],
                },
                {
                    "played_as": ghost,
                    "total": 0,
                    "time_ms": 0,
                    "abandoned": False,
                    "answers": [],
                },
            ],
        }
    )
    assert PostgresMatchResults(conn).record(result)
    full = update(Glicko(1500, 350, 0.06), [(Glicko(1700, 50, 0.06), 1.0)])
    row = conn.execute(
        "select rating, rd, volatility, games from player_rating where user_id = 'gra'"
    ).fetchone()
    assert row is not None
    assert float(row[0]) == pytest.approx(1500 + (full.rating - 1500) / 2)
    assert (float(row[1]), float(row[2]), row[3]) == pytest.approx(
        (full.rd, full.volatility, 1)
    )
    # The ghost's owner is untouched; one history row, the human's.
    assert conn.execute(
        "select count(*) from player_rating where user_id = 'grb'"
    ).fetchone() == (0,)
    assert conn.execute(
        "select user_id from rating_history where match_id = %s", (match_id,)
    ).fetchall() == [("gra",)]
    # The ghost's seat is expected in the result, not warned about.
    assert "not in the match" not in capsys.readouterr().out
    # The human's side is a real run, kept like any other.
    assert [r[0] for r in _runs(conn, match_id)] == ["gra"]


def test_an_unrated_match_keeps_its_run_at_the_rating_held(
    conn: psycopg.Connection,
) -> None:
    # The guest that signed up into its own opponent's account: one player, unrated.
    a_user(conn, "gra")
    question = _question(conn)
    conn.execute(
        "insert into player_rating (user_id, rating, rd, volatility, games)"
        " values ('gra', 1720, 90, 0.05, 8)"
    )
    match_id = _match(conn, [("gra", "guest-1")])
    conn.execute(
        "insert into game_match_player (match_id, user_id, played_as) values"
        " (%s, 'gra', 'lrb') on conflict do nothing",
        (match_id,),
    )
    result = _result(match_id, "finished", question)
    assert PostgresMatchResults(conn).record(result)
    runs = _runs(conn, match_id)
    assert [(r[0], r[2], r[3], r[4]) for r in runs] == [("gra", 1720.0, 90.0, 0.05)]


# P3-W17-S02 (BOT-2, BOT-4, Q-P3-26): a bot is an opponent at the player's own rating
# then, RD 350; the human moves half as much, and the bot's seat is no player.
def test_a_bot_match_moves_the_human_half_as_much_against_their_own_rating(
    conn: psycopg.Connection, capsys: pytest.CaptureFixture[str]
) -> None:
    a_user(conn, "gra")
    question = _question(conn)
    conn.execute(
        "insert into player_rating (user_id, rating, rd, volatility, games)"
        " values ('gra', 1640, 120, 0.06, 5)"
    )
    match_id = _match(conn, [("gra", None)])
    conn.execute(
        "update game_match set replay_seat = 'bot', replay_rating = 1640,"
        " replay_rd = 350, replay_volatility = 0.06 where id = %s",
        (match_id,),
    )
    result = MatchResult.model_validate(
        {
            "match_id": match_id,
            "finished_at": "2026-11-02T12:05:00Z",
            "outcome": "finished",
            "winner": "bot",
            "players": [
                {
                    "played_as": "gra",
                    "total": 0,
                    "time_ms": 0,
                    "abandoned": False,
                    "answers": [],
                },
                {
                    "played_as": "bot",
                    "total": 1,
                    "time_ms": 3000,
                    "abandoned": False,
                    "answers": [
                        {
                            "round": 1,
                            "question_id": question,
                            "choice": 0,
                            "correct": True,
                            "ms": 3000,
                        }
                    ],
                },
            ],
        }
    )
    assert PostgresMatchResults(conn).record(result)
    full = update(Glicko(1640, 120, 0.06), [(Glicko(1640, 350, 0.06), 0.0)])
    row = conn.execute(
        "select rating, rd from player_rating where user_id = 'gra'"
    ).fetchone()
    assert row is not None
    assert float(row[0]) == pytest.approx(1640 + (full.rating - 1640) / 2)
    assert float(row[1]) == pytest.approx(full.rd)
    assert "not in the match" not in capsys.readouterr().out


def test_a_ghost_match_whose_run_is_gone_is_still_rated_as_one(
    conn: psycopg.Connection, capsys: pytest.CaptureFixture[str]
) -> None:
    """The run's owner deleted their account mid-match: the match kept its replay."""
    a_user(conn, "gra")
    a_user(conn, "grb")
    question = _question(conn)
    match_id, run = _ghost_match(conn, question)
    conn.execute("delete from ghost_run where id = %s", (run,))
    result = MatchResult.model_validate(
        {
            "match_id": match_id,
            "finished_at": "2026-11-02T12:05:00Z",
            "outcome": "finished",
            "winner": "gra",
            "players": [
                {
                    "played_as": "gra",
                    "total": 1,
                    "time_ms": 2000,
                    "abandoned": False,
                    "answers": [],
                },
                {
                    "played_as": f"ghost:{run}",
                    "total": 0,
                    "time_ms": 0,
                    "abandoned": False,
                    "answers": [],
                },
            ],
        }
    )
    assert PostgresMatchResults(conn).record(result)
    full = update(Glicko(1500, 350, 0.06), [(Glicko(1700, 50, 0.06), 1.0)])
    row = conn.execute(
        "select rating from player_rating where user_id = 'gra'"
    ).fetchone()
    assert row is not None
    assert float(row[0]) == pytest.approx(1500 + (full.rating - 1500) / 2)
    assert "not in the match" not in capsys.readouterr().out


# P3-W17-S03 (Q-P3-16): a friend challenge is unrated; its answers still count.
def test_an_unrated_match_moves_no_rating_but_keeps_its_answers(
    conn: psycopg.Connection,
) -> None:
    a_user(conn, "lra")
    a_user(conn, "lrb")
    question = _question(conn)
    match_id = _match(conn, [("lra", "guest-1"), ("lrb", None)])
    conn.execute("update game_match set unrated = true where id = %s", (match_id,))
    assert PostgresMatchResults(conn).record(_result(match_id, "finished", question))
    assert _ratings(conn) == {}
    assert conn.execute(
        "select count(*) from rating_history where match_id = %s", (match_id,)
    ).fetchone() == (0,)
    assert conn.execute(
        "select count(*) from quiz_attempt where match_id = %s", (match_id,)
    ).fetchone() == (2,)


# P3-W18-S02 (§6.9, Q-P3-20): the game server's fair-play signals are kept with each
# player's side of the match; 3 or more raise a flag for review, and nothing else
# happens: no rating moves for them.


def test_the_golden_result_carries_signals() -> None:
    result = parse_result((GOLDEN / "match_finished.json").read_bytes())
    assert result is not None
    kinds = [(s.kind, s.round) for s in result.players[0].signals]
    assert kinds == [("speed", 1), ("focus", 1)]
    assert result.players[0].signals[0].ms == 310
    assert result.players[1].signals == []


@pytest.mark.parametrize(
    "signal",
    [
        {"kind": "paste", "round": 1, "ms": None},
        {"kind": "paste", "round": 1, "ms": 5, "chars": 300},
        {"kind": "away", "round": 1, "ms": None},
        {"kind": "focus", "round": 1, "ms": None, "chars": 3},
        {"kind": "away", "round": 46, "ms": 31_000},
        {"kind": "speed", "round": 0, "ms": 100},
        {"kind": "speed", "round": 1, "ms": -1},
        {"kind": "focus", "round": 1, "ms": None, "extra": 1},
    ],
)
def test_a_signal_that_is_not_one_is_refused(signal: dict[str, object]) -> None:
    body = json.loads((GOLDEN / "match_finished.json").read_bytes())
    body["players"][0]["signals"] = [signal]
    assert parse_result(json.dumps(body).encode()) is None


def _with_signals(result: MatchResult, count: int) -> MatchResult:
    signals = [
        FairPlaySignal(kind="focus", round=n, ms=None)
        if n % 2
        else FairPlaySignal(kind="speed", round=n, ms=120)
        for n in range(1, count + 1)
    ]
    first, *rest = result.players
    return result.model_copy(
        update={"players": [first.model_copy(update={"signals": signals}), *rest]}
    )


def _flags(conn: psycopg.Connection, match_id: str) -> list[tuple[Any, ...]]:
    return conn.execute(
        "select user_id, signals, decision, penalty from fair_play_flag "
        "where match_id = %s",
        (match_id,),
    ).fetchall()


def test_three_signals_raise_a_flag_and_move_no_rating(
    conn: psycopg.Connection,
) -> None:
    a_user(conn, "lra")
    a_user(conn, "lrb")
    question = _question(conn)
    plain = _match(conn, [("lra", "guest-1"), ("lrb", None)])
    PostgresMatchResults(conn).record(_result(plain, "finished", question))
    unflagged = _ratings(conn)
    conn.execute("delete from rating_history")
    conn.execute("delete from player_rating")

    match_id = _match(conn, [("lra", "guest-1"), ("lrb", None)])
    result = _with_signals(_result(match_id, "finished", question), 3)
    results = PostgresMatchResults(conn)
    assert results.record(result)
    assert _flags(conn, match_id) == [("lra", 3, None, None)]
    stored = conn.execute(
        "select user_id, signals from game_match_player where match_id = %s "
        "order by user_id",
        (match_id,),
    ).fetchall()
    assert [(u, len(s)) for u, s in stored] == [("lra", 3), ("lrb", 0)]
    assert stored[0][1][0] == {"kind": "focus", "round": 1, "ms": None}
    # No automatic penalty: rated exactly as the same match without signals.
    assert _ratings(conn) == unflagged
    # Recorded again: one flag still.
    assert not results.record(result)
    assert len(_flags(conn, match_id)) == 1


def test_two_signals_raise_none(conn: psycopg.Connection) -> None:
    a_user(conn, "lra")
    a_user(conn, "lrb")
    match_id = _match(conn, [("lra", "guest-1"), ("lrb", None)])
    result = _with_signals(_result(match_id, "finished", _question(conn)), 2)
    assert PostgresMatchResults(conn).record(result)
    assert _flags(conn, match_id) == []


def test_a_match_without_a_result_is_flagged_too(conn: psycopg.Connection) -> None:
    """Every outcome: a cancelled or void match's signals are still for review."""
    a_user(conn, "lra")
    a_user(conn, "lrb")
    match_id = _match(conn, [("lra", "guest-1"), ("lrb", None)])
    result = _with_signals(_result(match_id, "void", _question(conn)), 4)
    assert PostgresMatchResults(conn).record(result)
    assert _flags(conn, match_id) == [("lra", 4, None, None)]


def a_battle(conn: psycopg.Connection, players: list[str]) -> str:
    slug = "battle-results"
    digest = "b" * 64
    conn.execute(
        "insert into lld_problem (slug, title, difficulty, statement, interface, "
        "limits, visible, private_key, content_hash) values (%s, 'A problem', 'easy', "
        "'# A', '{}', '{}', '[]', %s, %s) on conflict do nothing",
        (slug, f"lld/problems/{slug}/{digest}.json", digest),
    )
    row = conn.execute(
        "insert into game_match (server_id, mode, problem_slug) "
        "values (0, 'battle', %s) returning id",
        (slug,),
    ).fetchone()
    assert row is not None
    for user_id in players:
        conn.execute(
            "insert into game_match_player (match_id, user_id) values (%s, %s)",
            (row[0], user_id),
        )
    return str(row[0])


def test_a_battle_is_stored_but_not_quick_rated_nor_kept_as_quiz_evidence(
    conn: psycopg.Connection,
) -> None:
    """P5-W31-S02b-2b (Q-P5-16): a battle's points, best-submission times, abandons
    and winner are stored; it's rated as a battle (W32-S01a), never as a quick game,
    and keeps no quiz answers or ghost runs."""
    a_user(conn, "lba")
    a_user(conn, "lbb")
    match_id = a_battle(conn, ["lba", "lbb"])
    result = MatchResult.model_validate(
        {
            "match_id": match_id,
            "finished_at": "2026-11-13T12:45:00Z",
            "outcome": "finished",
            "winner": "lba",
            "players": [
                {
                    "played_as": "lba",
                    "total": 1000,
                    "time_ms": 1_920_000,
                    "abandoned": False,
                    "answers": [],
                },
                {
                    "played_as": "lbb",
                    "total": 700,
                    "time_ms": 600_000,
                    "abandoned": False,
                    "answers": [],
                },
            ],
        }
    )
    assert PostgresMatchResults(conn).record(result) is True
    assert conn.execute(
        "select outcome, winner_id from game_match where id = %s", (match_id,)
    ).fetchone() == ("finished", "lba")
    assert conn.execute(
        "select user_id, total, time_ms, abandoned from game_match_player "
        "where match_id = %s order by user_id",
        (match_id,),
    ).fetchall() == [("lba", 1000, 1_920_000, False), ("lbb", 700, 600_000, False)]
    for table in ("quiz_attempt", "rating_history", "ghost_run"):
        assert conn.execute(
            f"select count(*) from {table} where match_id = %s",
            (match_id,),
        ).fetchone() == (0,), table


def test_an_abandoned_battle_is_stored_once_and_raises_no_quiz_flag(
    conn: psycopg.Connection,
) -> None:
    """A battle's signals are its own (W31-S04a): quiz signals on one flag nothing."""
    a_user(conn, "lbc")
    a_user(conn, "lbd")
    match_id = a_battle(conn, ["lbc", "lbd"])
    signals = [{"kind": "focus", "round": 1, "ms": None}] * 3
    result = MatchResult.model_validate(
        {
            "match_id": match_id,
            "finished_at": "2026-11-13T12:45:00Z",
            "outcome": "abandoned",
            "winner": "lbc",
            "players": [
                {
                    "played_as": "lbc",
                    "total": 300,
                    "time_ms": 60_000,
                    "abandoned": False,
                    "answers": [],
                    "signals": signals,
                },
                {
                    "played_as": "lbd",
                    "total": 0,
                    "time_ms": 2_700_000,
                    "abandoned": True,
                    "answers": [],
                },
            ],
        }
    )
    results = PostgresMatchResults(conn)
    assert results.record(result) is True
    assert results.record(result) is False
    assert conn.execute(
        "select user_id, total, abandoned from game_match_player "
        "where match_id = %s order by user_id",
        (match_id,),
    ).fetchall() == [("lbc", 300, False), ("lbd", 0, True)]
    assert conn.execute(
        "select count(*) from fair_play_flag where match_id = %s", (match_id,)
    ).fetchone() == (0,)


def _battle_with(
    conn: psycopg.Connection, user: str, signals: list[dict[str, object]]
) -> str:
    a_user(conn, user)
    match_id = a_battle(conn, [user])
    result = MatchResult.model_validate(
        {
            "match_id": match_id,
            "finished_at": "2026-11-13T12:45:00Z",
            "outcome": "finished",
            "winner": user,
            "players": [
                {
                    "played_as": user,
                    "total": 1000,
                    "time_ms": 600_000,
                    "abandoned": False,
                    "answers": [],
                    "signals": signals,
                }
            ],
        }
    )
    assert PostgresMatchResults(conn).record(result) is True
    return match_id


def _aways(count: int) -> list[dict[str, object]]:
    return [{"kind": "away", "round": n, "ms": 31_000} for n in range(1, count + 1)]


def test_one_outside_paste_flags_a_battle_player(conn: psycopg.Connection) -> None:
    """P5-W31-S04a (Q-P5-17): any paste the game server counted (200+ characters,
    not already the player's) goes to review, alone."""
    paste: dict[str, object] = {"kind": "paste", "round": 7, "ms": None, "chars": 640}
    match_id = _battle_with(conn, "lfa", [paste])
    assert _flags(conn, match_id) == [("lfa", 1, None, None)]
    assert conn.execute(
        "select signals from game_match_player where match_id = %s", (match_id,)
    ).fetchone() == ([paste],)


def test_five_long_aways_flag_a_battle_player_and_four_do_not(
    conn: psycopg.Connection,
) -> None:
    assert _flags(conn, _battle_with(conn, "lfb", _aways(4))) == []
    assert _flags(conn, _battle_with(conn, "lfc", _aways(5))) == [
        ("lfc", 5, None, None)
    ]


# P5-W32-S01a (MATCH-1, Q-P5-18): a 1v1 battle is rated with Glicko-2 in its league,
# apart from quick games' ratings.
def _battle_result(
    match_id: str,
    outcome: str,
    winner: str | None,
    players: list[tuple[str, int, bool]],
) -> MatchResult:
    return MatchResult.model_validate(
        {
            "match_id": match_id,
            "finished_at": "2026-11-13T12:45:00Z",
            "outcome": outcome,
            "winner": winner,
            "players": [
                {
                    "played_as": user,
                    "total": total,
                    "time_ms": 600_000,
                    "abandoned": abandoned,
                    "answers": [],
                }
                for user, total, abandoned in players
            ],
        }
    )


def _battle_ratings(
    conn: psycopg.Connection, users: list[str], league: str = "human"
) -> dict[str, tuple[float, int]]:
    return {
        user: (rating, games)
        for user, rating, games in conn.execute(
            "select user_id, rating, games from battle_rating "
            "where user_id = any(%s) and league = %s",
            (users, league),
        ).fetchall()
    }


def test_a_decisive_battle_rates_both_players_in_its_league(
    conn: psycopg.Connection,
) -> None:
    for user in ("bra", "brb"):
        a_user(conn, user)
    match_id = a_battle(conn, ["bra", "brb"])
    result = _battle_result(
        match_id, "finished", "bra", [("bra", 1000, False), ("brb", 700, False)]
    )
    results = PostgresMatchResults(conn)
    assert results.record(result) is True
    ratings = _battle_ratings(conn, ["bra", "brb"])
    assert ratings["bra"][0] > 1500 > ratings["brb"][0]
    assert ratings["bra"][1] == ratings["brb"][1] == 1
    assert conn.execute(
        "select user_id, league, rating_before, score from battle_rating_history "
        "where match_id = %s order by user_id",
        (match_id,),
    ).fetchall() == [("bra", "human", 1500.0, 1.0), ("brb", "human", 1500.0, 0.0)]
    assert conn.execute(
        "select rated_at is not null from game_match where id = %s", (match_id,)
    ).fetchone() == (True,)
    # Quick-game ratings are another thing entirely.
    assert conn.execute(
        "select count(*) from player_rating where user_id in ('bra', 'brb')"
    ).fetchone() == (0,)
    # Recorded once, rated once.
    assert results.record(result) is False
    assert _battle_ratings(conn, ["bra"])["bra"][1] == 1


def test_a_drawn_battle_moves_equal_ratings_nowhere(conn: psycopg.Connection) -> None:
    for user in ("brc", "brd"):
        a_user(conn, user)
    match_id = a_battle(conn, ["brc", "brd"])
    PostgresMatchResults(conn).record(
        _battle_result(
            match_id, "finished", None, [("brc", 700, False), ("brd", 700, False)]
        )
    )
    ratings = _battle_ratings(conn, ["brc", "brd"])
    assert ratings["brc"][0] == pytest.approx(1500)
    assert ratings["brd"][0] == pytest.approx(1500)


def test_an_abandoned_battle_is_a_loss_for_the_leaver(
    conn: psycopg.Connection,
) -> None:
    for user in ("bre", "brf"):
        a_user(conn, user)
    match_id = a_battle(conn, ["bre", "brf"])
    PostgresMatchResults(conn).record(
        _battle_result(
            match_id, "abandoned", "bre", [("bre", 300, False), ("brf", 0, True)]
        )
    )
    ratings = _battle_ratings(conn, ["bre", "brf"])
    assert ratings["bre"][0] > 1500 > ratings["brf"][0]


def test_a_cancelled_battle_or_an_ai_league_one_leaves_the_human_ratings(
    conn: psycopg.Connection,
) -> None:
    for user in ("brg", "brh"):
        a_user(conn, user)
    cancelled = a_battle(conn, ["brg", "brh"])
    PostgresMatchResults(conn).record(
        _battle_result(
            cancelled, "cancelled", None, [("brg", 0, False), ("brh", 0, False)]
        )
    )
    assert _battle_ratings(conn, ["brg", "brh"]) == {}
    ai = a_battle(conn, ["brg", "brh"])
    conn.execute("update game_match set league = 'ai' where id = %s", (ai,))
    PostgresMatchResults(conn).record(
        _battle_result(
            ai, "finished", "brg", [("brg", 900, False), ("brh", 100, False)]
        )
    )
    assert _battle_ratings(conn, ["brg", "brh"]) == {}
    assert _battle_ratings(conn, ["brg", "brh"], "ai")["brg"][0] > 1500


def test_unrated_rooms_and_self_battles_leave_battle_ratings_alone(
    conn: psycopg.Connection,
) -> None:
    """An unrated battle (as a friend challenge is), a room of 3 (rated as a room,
    W32-S01b) and a guest who signed up into its opponent's account move no 1v1
    battle rating."""
    for user in ("bri", "brj", "brk"):
        a_user(conn, user)
    unrated = a_battle(conn, ["bri", "brj"])
    conn.execute("update game_match set unrated = true where id = %s", (unrated,))
    room = a_battle(conn, ["bri", "brj", "brk"])
    self_battle = a_battle(conn, ["bri"])
    conn.execute(
        "update game_match_player set played_as = 'guest-1' where match_id = %s",
        (self_battle,),
    )
    conn.execute(
        "insert into game_match_player (match_id, user_id, played_as) "
        "values (%s, 'bri', 'bri')"
        " on conflict do nothing",
        (self_battle,),
    )
    results = PostgresMatchResults(conn)
    win = [("bri", 900, False), ("brj", 100, False)]
    assert results.record(_battle_result(unrated, "finished", "bri", win))
    assert results.record(
        _battle_result(room, "finished", "bri", [*win, ("brk", 50, False)])
    )
    assert results.record(
        _battle_result(
            self_battle, "finished", "bri", [("bri", 900, False), ("guest-1", 0, False)]
        )
    )
    assert _battle_ratings(conn, ["bri", "brj", "brk"]) == {}


# P5-W32-S01b (MATCH-1, Q-P5-18): a room of 3 or 4 is rated with OpenSkill in its
# league, by points then time, the abandoned last; apart from 1v1 battle ratings.
def _room_skills(
    conn: psycopg.Connection, users: list[str], league: str = "human"
) -> dict[str, tuple[float, int]]:
    return {
        user: (mu, games)
        for user, mu, games in conn.execute(
            "select user_id, mu, games from room_rating "
            "where user_id = any(%s) and league = %s",
            (users, league),
        ).fetchall()
    }


def test_a_room_is_rated_with_openskill_once(conn: psycopg.Connection) -> None:
    users = ["rma", "rmb", "rmc", "rmd"]
    for user in users:
        a_user(conn, user)
    match_id = a_battle(conn, users)
    result = _battle_result(
        match_id,
        "abandoned",
        "rma",
        [
            ("rma", 1000, False),
            ("rmb", 700, False),
            ("rmc", 700, False),
            ("rmd", 0, True),
        ],
    )
    results = PostgresMatchResults(conn)
    assert results.record(result) is True
    skills = _room_skills(conn, users)
    assert skills["rma"][0] > 25 > skills["rmd"][0]
    assert skills["rmb"] == skills["rmc"]
    assert all(games == 1 for _, games in skills.values())
    assert conn.execute(
        "select user_id, rank, mu_before from room_rating_history "
        "where match_id = %s order by user_id",
        (match_id,),
    ).fetchall() == [
        ("rma", 1, 25.0),
        ("rmb", 2, 25.0),
        ("rmc", 2, 25.0),
        ("rmd", 4, 25.0),
    ]
    assert _battle_ratings(conn, users) == {}
    assert results.record(result) is False
    assert _room_skills(conn, ["rma"])["rma"][1] == 1


def test_an_unrated_or_cancelled_room_moves_nothing(conn: psycopg.Connection) -> None:
    users = ["rme", "rmf", "rmg"]
    for user in users:
        a_user(conn, user)
    seats = [("rme", 900, False), ("rmf", 500, False), ("rmg", 100, False)]
    cancelled = a_battle(conn, users)
    unrated = a_battle(conn, users)
    conn.execute("update game_match set unrated = true where id = %s", (unrated,))
    results = PostgresMatchResults(conn)
    results.record(_battle_result(cancelled, "cancelled", None, seats))
    results.record(_battle_result(unrated, "finished", "rme", seats))
    assert _room_skills(conn, users) == {}
