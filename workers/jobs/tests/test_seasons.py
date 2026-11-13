"""P3-W16-S06 (Q-P3-13; owner, 2026-11-03): monthly quick-game seasons. On the 1st
(UTC) the month just ended closes once: its final board is kept, and every rating is
soft-reset."""

from datetime import UTC, datetime

import psycopg
import pytest

from interval_jobs.adapters.memory import InMemorySeasons
from interval_jobs.adapters.postgres import PostgresSeasons
from interval_jobs.seasons import close_season, season_before

from .test_db_guards import a_user


@pytest.mark.parametrize(
    ("now", "season", "start", "end"),
    [
        (
            datetime(2026, 12, 1, 0, 5, tzinfo=UTC),
            "2026-11",
            datetime(2026, 11, 1, tzinfo=UTC),
            datetime(2026, 12, 1, tzinfo=UTC),
        ),
        (
            datetime(2027, 1, 15, tzinfo=UTC),
            "2026-12",
            datetime(2026, 12, 1, tzinfo=UTC),
            datetime(2027, 1, 1, tzinfo=UTC),
        ),
    ],
)
def test_the_season_before_now(
    now: datetime, season: str, start: datetime, end: datetime
) -> None:
    assert season_before(now) == (season, start, end)


def test_closing_closes_the_month_just_ended_once() -> None:
    seasons = InMemorySeasons()
    now = datetime(2026, 12, 1, 0, 5, tzinfo=UTC)
    assert close_season(seasons, now) == {"season": "2026-11", "closed": True}
    assert close_season(seasons, now) == {"season": "2026-11", "closed": False}
    assert seasons.closed == ["2026-11"]


def _match(conn: psycopg.Connection) -> str:
    row = conn.execute(
        "insert into game_match (server_id) values (0) returning id::text"
    ).fetchone()
    assert row is not None
    return str(row[0])


def _rated(conn: psycopg.Connection, user: str, after: float, at: datetime) -> None:
    conn.execute(
        "insert into rating_history (user_id, match_id, rating_before, rating_after,"
        " rd_after, volatility_after, score, at)"
        " values (%s, %s, 1500, %s, 100, 0.06, 1, %s)",
        (user, _match(conn), after, at),
    )


def test_postgres_keeps_the_final_board_and_resets_every_rating(
    conn: psycopg.Connection,
) -> None:
    for user in ("sa", "sb", "sc"):
        a_user(conn, user)
    # sa played twice in the season; sb once, then again after it ended (before the
    # job ran); sc not at all in it.
    _rated(conn, "sa", 1600, datetime(2031, 1, 3, tzinfo=UTC))
    _rated(conn, "sa", 1700, datetime(2031, 1, 30, tzinfo=UTC))
    _rated(conn, "sb", 1400, datetime(2031, 1, 31, 23, 59, tzinfo=UTC))
    _rated(conn, "sb", 1450, datetime(2031, 2, 1, 0, 1, tzinfo=UTC))
    _rated(conn, "sc", 1900, datetime(2030, 12, 31, tzinfo=UTC))
    conn.execute(
        "insert into player_rating (user_id, rating, rd, volatility, games) values"
        " ('sa', 1700, 100, 0.06, 2), ('sb', 1450, 200, 0.06, 2),"
        " ('sc', 1900, 60, 0.07, 1)"
    )
    # P5-W32-S01a (Q-P5-18): battle ratings, per league, are reset too.
    conn.execute(
        "insert into battle_rating (user_id, league, rating, rd, volatility, games)"
        " values ('sa', 'human', 1300, 90, 0.06, 3), ('sa', 'ai', 1700, 200, 0.05, 1)"
    )
    # P5-W32-S01b: and room ratings (OpenSkill).
    conn.execute(
        "insert into room_rating (user_id, league, mu, sigma, games)"
        " values ('sb', 'human', 33, 1, 4)"
    )
    seasons = PostgresSeasons(conn)
    start, end = datetime(2031, 1, 1, tzinfo=UTC), datetime(2031, 2, 1, tzinfo=UTC)

    assert seasons.close("2031-01", start, end) is True
    kept = dict(
        conn.execute(
            "select user_id, rating from season_standing where season = '2031-01'"
            " and user_id in ('sa', 'sb', 'sc')"
        ).fetchall()
    )
    assert kept == {"sa": 1700, "sb": 1400}
    ratings = {
        str(u): (float(r), float(d), float(v))
        for u, r, d, v in conn.execute(
            "select user_id, rating, rd, volatility from player_rating"
            " where user_id in ('sa', 'sb', 'sc')"
        ).fetchall()
    }
    assert ratings["sa"] == pytest.approx((1650, 150, 0.06))
    assert ratings["sb"] == pytest.approx((1462.5, 200, 0.06))
    assert ratings["sc"] == pytest.approx((1800, 150, 0.07))
    battles = {
        str(league): (float(r), float(d), float(v))
        for league, r, d, v in conn.execute(
            "select league, rating, rd, volatility from battle_rating"
            " where user_id = 'sa'"
        ).fetchall()
    }
    assert battles["human"] == pytest.approx((1350, 150, 0.06))
    assert battles["ai"] == pytest.approx((1650, 200, 0.05))
    room = conn.execute(
        "select mu, sigma from room_rating where user_id = 'sb'"
    ).fetchone()
    assert room is not None
    assert (float(room[0]), float(room[1])) == pytest.approx((31, 25 / 3 * 150 / 350))

    # Once: a second close changes nothing.
    assert seasons.close("2031-01", start, end) is False
    again = conn.execute(
        "select rating from player_rating where user_id = 'sa'"
    ).fetchone()
    assert again is not None and float(again[0]) == pytest.approx(1650)


def test_a_close_after_the_first_closes_the_month_just_ended_or_nothing() -> None:
    # Run daily: a failed 1st is tried again on the 2nd; later runs find it closed.
    seasons = InMemorySeasons()
    second = datetime(2026, 12, 2, tzinfo=UTC)
    assert close_season(seasons, second) == {"season": "2026-11", "closed": True}
    late = datetime(2026, 12, 20, tzinfo=UTC)
    assert close_season(seasons, late) == {"season": "2026-11", "closed": False}
