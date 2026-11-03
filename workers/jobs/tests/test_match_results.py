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
from interval_jobs.match_results import MatchResult, parse_result, relay
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
