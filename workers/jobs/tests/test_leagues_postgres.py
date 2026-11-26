"""ADR-0045 against Postgres: the sources points come from, the ledger's once-only key
(LOAD-5), the rank and move views the web app reads too, and Monday's close."""

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import psycopg
import pytest

from interval_jobs.adapters.postgres import PostgresLeagues
from interval_jobs.leagues import close_leagues_due, credit_source

from .test_db_guards import a_user

# A Wednesday, in a week no other data uses.
WED = datetime(2031, 3, 5, 12, tzinfo=UTC)
MONDAY = date(2031, 3, 3)
UTC_ZONE = ZoneInfo("UTC")


def _guest(conn: psycopg.Connection, user_id: str) -> None:
    a_user(conn, user_id)
    conn.execute("update app_user set is_anonymous = true where id = %s", (user_id,))


def _match(
    conn: psycopg.Connection,
    players: list[str],
    winner: str | None = None,
    *,
    at: datetime = WED,
    outcome: str = "finished",
    battle_mode: str = "human",
) -> str:
    row = conn.execute(
        "insert into game_match (server_id, mode, finished_at, outcome, winner_id,"
        " battle_mode) values (0, 'sprint', %s, %s, %s, %s) returning id::text",
        (at, outcome, winner, battle_mode),
    ).fetchone()
    assert row is not None
    for user in players:
        conn.execute(
            "insert into game_match_player (match_id, user_id, abandoned)"
            " values (%s, %s, false)",
            (row[0], user),
        )
    return str(row[0])


def _points(conn: psycopg.Connection, user: str) -> int:
    row = conn.execute(
        "select coalesce(sum(points), 0) from league_points where user_id = %s",
        (user,),
    ).fetchone()
    assert row is not None
    return int(row[0])


def test_a_match_scores_its_players_once_and_never_a_guest(
    conn: psycopg.Connection,
) -> None:
    a_user(conn, "lga")
    _guest(conn, "lgg")
    leagues = PostgresLeagues(conn)
    leagues.form(leagues.week(MONDAY, "UTC").id, [], WED)  # mid-week
    match = _match(conn, ["lga", "lgg"], winner="lga")

    placed = credit_source(leagues, "match", match, UTC_ZONE)
    credit_source(leagues, "match", match, UTC_ZONE)

    assert (_points(conn, "lga"), _points(conn, "lgg")) == (15, 0)
    assert [(p.user.user_id, p.tier, p.cohort_size, p.mid_week) for p in placed] == [
        ("lga", "bronze", 1, True)
    ]
    assert placed[0].user.beta_group == "student"
    week = leagues.week_starting(MONDAY)
    assert week is not None and leagues.member(week.id, "lga")


def test_a_plan_without_leagues_scores_nothing(conn: psycopg.Connection) -> None:
    a_user(conn, "lgp")
    conn.execute("insert into plan (id, name) values ('lgplan', 'No leagues')")
    conn.execute("update app_user set plan_id = 'lgplan' where id = 'lgp'")
    leagues = PostgresLeagues(conn)
    credit_source(leagues, "match", _match(conn, ["lgp"]), UTC_ZONE)
    assert _points(conn, "lgp") == 0


def test_unfinished_and_unknown_sources_score_nothing(conn: psycopg.Connection) -> None:
    a_user(conn, "lgu")
    leagues = PostgresLeagues(conn)
    row = conn.execute(
        "insert into game_match (server_id) values (0) returning id::text"
    ).fetchone()
    assert row is not None
    assert leagues.match(str(row[0])) is None
    assert leagues.match("not-a-uuid") is None
    assert leagues.checkpoint("x1") is None
    assert leagues.penalty("99999999999") is None


def test_the_cap_counts_the_leagues_day(conn: psycopg.Connection) -> None:
    a_user(conn, "lgc")
    leagues = PostgresLeagues(conn)
    for n in range(21):  # 21 wins: 315 points before the cap
        match = _match(conn, ["lgc"], winner="lgc", at=WED + timedelta(minutes=n))
        credit_source(leagues, "match", match, UTC_ZONE)
    assert _points(conn, "lgc") == 300
    capped = conn.execute(
        "select count(*) from league_points where user_id = 'lgc' and points = 0"
    ).fetchone()
    assert capped is not None and capped[0] == 1


def test_a_penalty_on_a_human_match_takes_its_points_back(
    conn: psycopg.Connection,
) -> None:
    a_user(conn, "lgf")
    a_user(conn, "lgadmin")
    leagues = PostgresLeagues(conn)
    human = _match(conn, ["lgf"], winner="lgf")
    ai = _match(
        conn, ["lgf"], winner="lgf", at=WED + timedelta(hours=1), battle_mode="ai"
    )
    for match in (human, ai):
        credit_source(leagues, "match", match, UTC_ZONE)
    flags = [
        conn.execute(
            "insert into fair_play_flag (match_id, user_id, signals, decision,"
            " decided_at, decided_by, penalty) values"
            " (%s, 'lgf', 3, 'penalized', %s, 'lgadmin', 10) returning id::text",
            (match, WED + timedelta(days=10)),
        ).fetchone()
        for match in (human, ai)
    ]
    for flag in flags:
        assert flag is not None
        credit_source(leagues, "fair_play", str(flag[0]), UTC_ZONE)
        credit_source(leagues, "fair_play", str(flag[0]), UTC_ZONE)
    # §6.9: the AI-mode match's points stay.
    assert _points(conn, "lgf") == 15
    # And a human match scored after its penalty scores nothing for that seat.
    late = _match(conn, ["lgf"], winner="lgf", at=WED + timedelta(hours=2))
    conn.execute(
        "insert into fair_play_flag (match_id, user_id, signals, decision,"
        " decided_at, decided_by, penalty) values"
        " (%s, 'lgf', 3, 'penalized', now(), 'lgadmin', 10)",
        (late,),
    )
    credit_source(leagues, "match", late, UTC_ZONE)
    assert _points(conn, "lgf") == 15


def test_a_passed_checkpoint_scores(conn: psycopg.Connection) -> None:
    a_user(conn, "lgk")
    leagues = PostgresLeagues(conn)
    # The section and the attempt's shape are the checkpoint's; only the facts matter.
    section = conn.execute("select id from path_section order by id limit 1").fetchone()
    if section is None:
        pytest.skip("no path section in this database")
    attempts = [
        conn.execute(
            "insert into quiz_attempt (user_id, path_section_id, checkpoint_size,"
            " ends_at, finished_at, checkpoint_passed) values"
            " ('lgk', %s, 5, %s, %s, true) returning id::text",
            (section[0], WED, WED),
        ).fetchone()
        for _ in range(2)
    ]
    facts = leagues.checkpoint(str(attempts[0][0]) if attempts[0] else "")
    assert facts is not None and facts.passed and facts.user_id == "lgk"
    assert facts.checkpoint == f"section-{section[0]}"
    for row in attempts:
        assert row is not None
        credit_source(leagues, "checkpoint", str(row[0]), UTC_ZONE)
    # Owner, 2026-11-26: only the first pass of a checkpoint scores.
    assert _points(conn, "lgk") == 10


def test_the_daily_challenge_scores_5_once(conn: psycopg.Connection) -> None:
    a_user(conn, "lgd")
    leagues = PostgresLeagues(conn)
    conn.execute(
        "insert into daily_challenge (day) values ('2031-03-05') on conflict do nothing"
    )
    row = conn.execute(
        "insert into quiz_attempt (user_id, daily_day, ends_at, finished_at)"
        " values ('lgd', '2031-03-05', %s, %s) returning id::text",
        (WED, WED),
    ).fetchone()
    assert row is not None
    credit_source(leagues, "daily", str(row[0]), UTC_ZONE)
    credit_source(leagues, "daily", str(row[0]), UTC_ZONE)
    assert _points(conn, "lgd") == 5
    assert leagues.daily("not-an-id") is None


def test_who_stayed_in_an_abandoned_match_scores_without_the_bonus(
    conn: psycopg.Connection,
) -> None:
    a_user(conn, "lgs")
    a_user(conn, "lgl")
    leagues = PostgresLeagues(conn)
    match = _match(conn, ["lgs", "lgl"], winner="lgs", outcome="abandoned")
    conn.execute(
        "update game_match_player set abandoned = true"
        " where match_id = %s and user_id = 'lgl'",
        (match,),
    )
    credit_source(leagues, "match", match, UTC_ZONE)
    assert (_points(conn, "lgs"), _points(conn, "lgl")) == (10, 0)


def _members(
    conn: psycopg.Connection, leagues: PostgresLeagues, tier: str, users: list[str]
) -> int:
    week = leagues.week(MONDAY, "UTC")
    for user in users:
        a_user(conn, user)
        conn.execute(
            "insert into league_player (user_id, tier) values (%s, %s)", (user, tier)
        )
        leagues.place(week.id, user, tier, 0, 30)  # type: ignore[arg-type]
    return week.id


def _earn(
    conn: psycopg.Connection, week: int, user: str, points: int, at: datetime
) -> None:
    conn.execute(
        "insert into league_points (user_id, week_id, source_kind, source_id, points,"
        " reason, at) values (%s, %s, 'checkpoint', %s, %s, 'checkpoint', %s)",
        (user, week, f"{user}{at.timestamp()}", points, at),
    )


def test_the_views_rank_and_count_moves(conn: psycopg.Connection) -> None:
    leagues = PostgresLeagues(conn)
    users = [f"lgr{n:02d}" for n in range(30)]
    week = _members(conn, leagues, "sapphire", users)
    for n, user in enumerate(users[:-1]):
        _earn(conn, week, user, 100 - n // 2, WED + timedelta(minutes=n))
    [cohort] = leagues.cohorts(week)
    assert (cohort.tier, cohort.up, cohort.down) == ("sapphire", 7, 5)
    ranked = [m.user.user_id for m in cohort.members]
    # Pairs tie on points; the one who reached it first ranks first; no points last.
    assert ranked[:3] == ["lgr00", "lgr01", "lgr02"]
    assert ranked[-1] == "lgr29"
    assert cohort.members[-1].points == 0


@pytest.mark.parametrize(
    ("tier", "size", "up", "down"),
    [
        ("gold", 3, 1, 1),
        ("gold", 4, 1, 1),
        ("gold", 2, 0, 0),
        ("gold", 15, 4, 3),
        ("bronze", 30, 7, 0),
        ("diamond", 30, 0, 5),
    ],
)
def test_moves_scale_with_size(
    conn: psycopg.Connection, tier: str, size: int, up: int, down: int
) -> None:
    leagues = PostgresLeagues(conn)
    _members(conn, leagues, tier, [f"lgm{n:02d}" for n in range(size)])
    [cohort] = leagues.cohorts(leagues.week(MONDAY, "UTC").id)
    assert (cohort.up, cohort.down) == (up, down)


def test_monday_closes_last_week_and_forms_this_one_once(
    conn: psycopg.Connection,
) -> None:
    leagues = PostgresLeagues(conn)
    users = [f"lgw{n}" for n in range(5)]
    week = _members(conn, leagues, "silver", users)
    kolkata = ZoneInfo("Asia/Kolkata")
    # lgw0: two days in Kolkata (Wed 12:00 UTC and Wed 20:00 UTC, Thu there).
    _earn(conn, week, "lgw0", 50, WED)
    _earn(conn, week, "lgw0", 50, WED + timedelta(hours=8))
    for user in users[1:4]:
        _earn(conn, week, user, 20, WED)
    conn.execute(
        "update league_week set time_zone = 'Asia/Kolkata' where id = %s", (week,)
    )
    now = datetime(2031, 3, 10, 1, tzinfo=UTC)

    closed, placed = close_leagues_due(leagues, now, kolkata)
    again = close_leagues_due(leagues, now, kolkata)

    outcome = {c.user.user_id: (c.rank, c.outcome) for c in closed}
    assert outcome["lgw0"] == (1, "up") and outcome["lgw4"] == (5, "down")
    tiers = dict(
        conn.execute(
            "select user_id, tier::text from league_player where user_id like 'lgw%%'"
        ).fetchall()
    )
    assert tiers["lgw0"] == "gold" and tiers["lgw4"] == "bronze"
    assert {p.user.user_id for p in placed} == {"lgw0", "lgw1", "lgw2", "lgw3"}
    pace = dict(
        conn.execute(
            "select m.user_id, m.pace_days from league_member m"
            " join league_week w on w.id = m.week_id"
            " where w.starts_on = '2031-03-10' and m.user_id like 'lgw%%'"
        ).fetchall()
    )
    assert pace == {"lgw0": 2, "lgw1": 1, "lgw2": 1, "lgw3": 1}
    final = conn.execute(
        "select final_rank, outcome from league_member"
        " where week_id = %s and user_id = 'lgw4'",
        (week,),
    ).fetchone()
    assert final == (5, "down")
    assert again == ([], [])


def test_points_before_mondays_run_are_placed_by_it_at_the_moved_tier(
    conn: psycopg.Connection,
) -> None:
    leagues = PostgresLeagues(conn)
    users = [f"lgo{n}" for n in range(4)]
    week = _members(conn, leagues, "gold", users)
    for n, user in enumerate(users):
        _earn(conn, week, user, 40 - n, WED)
    a_user(conn, "lgonew")
    monday = datetime(2031, 3, 10, 0, 10, tzinfo=UTC)
    for user in ("lgo0", "lgonew"):
        match = _match(conn, [user], at=monday)
        assert credit_source(leagues, "match", match, UTC_ZONE) == []
    _, placed = close_leagues_due(leagues, monday + timedelta(hours=1), UTC_ZONE)

    by_user = {p.user.user_id: p for p in placed}
    assert (by_user["lgo0"].tier, by_user["lgo0"].mid_week) == ("sapphire", False)
    assert (by_user["lgonew"].tier, by_user["lgonew"].mid_week) == ("bronze", True)
    assert by_user["lgo3"].tier == "silver"


def test_a_capped_row_doesnt_move_when_a_total_was_reached(
    conn: psycopg.Connection,
) -> None:
    leagues = PostgresLeagues(conn)
    week = _members(conn, leagues, "gold", ["lgx", "lgy"])
    _earn(conn, week, "lgx", 50, WED)
    _earn(conn, week, "lgy", 50, WED + timedelta(hours=1))
    _earn(conn, week, "lgx", 0, WED + timedelta(hours=2))
    [cohort] = leagues.cohorts(week)
    assert [m.user.user_id for m in cohort.members] == ["lgx", "lgy"]
