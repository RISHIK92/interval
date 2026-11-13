"""The Phase 1 "done when" queries (Q-P1-21, P1-W6-S04), run on fixture events with
DuckDB (owner, 2026-10-26) the way Athena runs them on the Firehose events: the same
columns and props struct as the Glue table, and a macro for the one Trino function
DuckDB lacks. Today is fixed, so the full-window rules are exact."""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import duckdb
import pytest

QUERIES = Path(__file__).parents[3] / "packages" / "events" / "queries"
TODAY = datetime(2026, 11, 30, tzinfo=UTC)
# The props the queries read; the Glue table declares the same struct (aws-stack.ts).
PROPS = (
    "STRUCT(kind VARCHAR, item_id VARCHAR, moment_id VARCHAR, method VARCHAR, "
    "question_id VARCHAR, path_id VARCHAR, section_id VARCHAR, passed BOOLEAN, "
    "game VARCHAR, wait_ms BIGINT, opponent VARCHAR, explainer_id VARCHAR, "
    '"on" BOOLEAN, registered BIGINT, matched BIGINT)'
)

type Row = tuple[str, int, int, float]


def event(
    name: str,
    user: str,
    at: datetime,
    group: str = "student",
    guest: bool = False,
    version: int = 1,
    source: str = "web",
    **props: str | bool | int | None,
) -> dict[str, object]:
    return {
        "event_id": str(uuid4()),
        "occurred_at": at.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "user_id": user,
        "is_guest": guest,
        "beta_group": group,
        "session_id": None,
        "source": source,
        "name": name,
        "version": version,
        "props": props,
    }


def run(query: str, events: list[dict[str, object]], tmp_path: Path) -> list[Row]:
    path = tmp_path / "events.jsonl"
    path.write_text("".join(json.dumps(e) + "\n" for e in events))
    db = duckdb.connect()
    db.execute("set TimeZone = 'UTC'")
    db.execute("create macro from_iso8601_timestamp(s) as cast(s as timestamptz)")
    db.execute(
        f"""
        create table events as select * from read_json(?, format = 'newline_delimited',
          columns = {{event_id: 'VARCHAR', occurred_at: 'VARCHAR', user_id: 'VARCHAR',
                     is_guest: 'BOOLEAN', beta_group: 'VARCHAR',
                     session_id: 'VARCHAR', source: 'VARCHAR', name: 'VARCHAR',
                     version: 'INTEGER', props: '{PROPS}'}})
        """,
        [str(path)],
    )
    sql = (QUERIES / query).read_text()
    assert "current_date" in sql
    today = f"date '{TODAY.date().isoformat()}'"
    rows = db.execute(sql.replace("current_date", today)).fetchall()
    return [(str(g), int(n), int(k), round(float(r), 4)) for g, n, k, r in rows]


def days(n: float) -> timedelta:
    return timedelta(days=n)


SIGNUP = TODAY - days(20)


def test_return_counts_a_session_in_days_7_to_13_after_signup(tmp_path: Path) -> None:
    events = [
        *(event("signup_completed", u, SIGNUP) for u in "abcde"),
        event("session_started", "a", SIGNUP + days(7)),  # first day of the window
        event("session_started", "b", SIGNUP + days(13.9)),  # last day of it
        event("session_started", "c", SIGNUP + days(6.9)),  # too early
        event("session_started", "d", SIGNUP + days(14)),  # too late
        # e never comes back
    ]
    assert run("return_rate.sql", events, tmp_path) == [("student", 5, 2, 0.4)]


def test_return_leaves_out_guests_and_signups_still_in_their_window(
    tmp_path: Path,
) -> None:
    events = [
        event("signup_completed", "a", SIGNUP),
        event("session_started", "a", SIGNUP + days(8)),
        event("signup_completed", "g", SIGNUP, guest=True),
        event("signup_completed", "new", TODAY - days(13)),  # window not closed yet
        event("session_started", "new", TODAY - days(5)),
    ]
    assert run("return_rate.sql", events, tmp_path) == [("student", 1, 1, 1.0)]


def test_return_is_split_by_beta_group(tmp_path: Path) -> None:
    events = [
        event("signup_completed", "s1", SIGNUP),
        event("signup_completed", "s2", SIGNUP),
        event("session_started", "s1", SIGNUP + days(9)),
        event("signup_completed", "d1", SIGNUP, group="developer"),
        event("session_started", "d1", SIGNUP + days(10), group="developer"),
    ]
    assert run("return_rate.sql", events, tmp_path) == [
        ("developer", 1, 1, 1.0),
        ("student", 2, 1, 0.5),
    ]


OPENED = TODAY - days(10)


def opened(
    user: str,
    item: str,
    moment: str | None,
    at: datetime = OPENED,
    group: str = "student",
    guest: bool = False,
) -> dict[str, object]:
    return event(
        "card_opened",
        user,
        at,
        group=group,
        guest=guest,
        version=2,
        kind="article" if moment is None else "moment",
        item_id=item,
        moment_id=moment,
    )


def finished_section(
    user: str, item: str, moment: str, at: datetime
) -> dict[str, object]:
    return event(
        "section_finished",
        user,
        at,
        version=2,
        method="mark_done",
        item_id=item,
        moment_id=moment,
    )


def finished_article(user: str, item: str, at: datetime) -> dict[str, object]:
    return event(
        "article_finished", user, at, version=2, method="mark_done", item_id=item
    )


def test_an_open_counts_as_finished_by_its_own_finish_within_7_days(
    tmp_path: Path,
) -> None:
    events = [
        opened("u", "1", "11"),
        finished_section("u", "1", "11", OPENED + days(2)),  # its section: counts
        opened("u", "2", None),
        finished_article("u", "2", OPENED + days(6.9)),  # its article: counts
        opened("u", "3", "31"),
        finished_section("u", "3", "32", OPENED + days(1)),  # another section
        opened("u", "4", "41"),
        finished_section("u", "4", "41", OPENED + days(7)),  # too late
        opened("u", "5", None),
        finished_section(
            "u", "5", "51", OPENED + days(1)
        ),  # a section, not the article
    ]
    assert run("finished_rate.sql", events, tmp_path) == [("student", 5, 2, 0.4)]


def test_a_repeat_open_is_one_open_from_the_first_time(tmp_path: Path) -> None:
    events = [
        opened("u", "1", "11"),
        opened("u", "1", "11", OPENED + days(5)),
        # Within 7 days of the second open but not the first: not counted.
        finished_section("u", "1", "11", OPENED + days(8)),
    ]
    assert run("finished_rate.sql", events, tmp_path) == [("student", 1, 0, 0.0)]


def test_recent_opens_and_old_events_without_ids_are_left_out(tmp_path: Path) -> None:
    events = [
        opened("u", "1", "11"),
        finished_section("u", "1", "11", OPENED + days(1)),
        opened("u", "2", "21", TODAY - days(6)),  # still inside its window
        event("card_opened", "u", OPENED, kind="moment"),  # version 1: no ids
    ]
    assert run("finished_rate.sql", events, tmp_path) == [("student", 1, 1, 1.0)]


def test_finished_counts_guests_and_splits_by_beta_group(tmp_path: Path) -> None:
    events = [
        opened("g", "1", "11", guest=True),
        finished_section("g", "1", "11", OPENED + days(1)),
        opened("d", "1", "11", group="developer"),
        opened("d", "2", None, group="developer"),
        finished_article("d", "2", OPENED + days(3)),
    ]
    assert run("finished_rate.sql", events, tmp_path) == [
        ("developer", 2, 1, 0.5),
        ("student", 1, 1, 1.0),
    ]


@pytest.mark.parametrize("query", ["return_rate.sql", "finished_rate.sql"])
def test_no_events_give_no_rows(query: str, tmp_path: Path) -> None:
    assert run(query, [], tmp_path) == []


def test_only_the_users_own_finish_after_the_open_counts(tmp_path: Path) -> None:
    events = [
        finished_section("u", "1", "11", OPENED - days(1)),  # before the open
        opened("u", "1", "11"),
        opened("u", "2", "21"),
        finished_section("someone-else", "2", "21", OPENED + days(1)),
    ]
    assert run("finished_rate.sql", events, tmp_path) == [("student", 2, 0, 0.0)]


def test_a_moment_card_that_landed_on_the_article_counts_the_article_finish(
    tmp_path: Path,
) -> None:
    # "Open original website", or moments switched off: the open carries no moment
    # (owner, 2026-10-26), and the reader finishes the article.
    landed = opened("u", "1", None)
    landed["props"] = {**landed["props"], "kind": "moment"}  # type: ignore[dict-item]
    events = [landed, finished_article("u", "1", OPENED + days(1))]
    assert run("finished_rate.sql", events, tmp_path) == [("student", 1, 1, 1.0)]


# Phase 2 "done when" (P2-W9-S08, Q-P2-20): quizzes after finished moments, flags,
# and whether quiz takers come back more.
def quiz_started(user: str, moment: str, at: datetime) -> dict[str, object]:
    return event(
        "quiz_started", user, at, version=2, kind="test", item_id="1", moment_id=moment
    )


def test_a_finished_moment_leads_to_a_quiz_on_it_within_a_day(tmp_path: Path) -> None:
    done = TODAY - days(5)
    events = [
        finished_section("u", "1", "11", done),
        quiz_started("u", "11", done + days(0.5)),  # after: counts
        finished_section("u", "1", "12", done),
        quiz_started("u", "12", done - days(0.1)),  # just before (reader): counts
        finished_section("u", "1", "13", done),
        quiz_started("u", "14", done),  # another moment
        finished_section("u", "1", "15", done),
        quiz_started("u", "15", done + days(1.5)),  # too late
        finished_section("v", "1", "11", done),  # someone else's quiz doesn't count
        finished_section("w", "1", "16", TODAY - days(0.5)),  # window still open
        quiz_started("w", "16", TODAY - days(0.4)),
    ]
    assert run("quiz_rate.sql", events, tmp_path) == [("student", 5, 2, 0.4)]


def test_a_review_isnt_a_quiz_on_the_moment(tmp_path: Path) -> None:
    done = TODAY - days(5)
    events = [
        finished_section("u", "1", "11", done),
        event("quiz_started", "u", done, version=2, kind="review"),
        event("quiz_started", "u", done, version=1, item_id="1", moment_id="11"),
    ]
    assert run("quiz_rate.sql", events, tmp_path) == [("student", 1, 0, 0.0)]


def test_the_flag_rate_is_flagged_questions_over_answered_ones(tmp_path: Path) -> None:
    def answered(user: str, question: str) -> dict[str, object]:
        return event("quiz_answered", user, TODAY - days(1), question_id=question)

    def flagged(user: str, question: str) -> dict[str, object]:
        return event("question_flagged", user, TODAY - days(1), question_id=question)

    events = [
        *(answered(u, q) for u in "ab" for q in ("1", "2", "3", "4")),
        flagged("a", "2"),
        flagged("b", "2"),  # one question, flagged twice: one flagged question
    ]
    assert run("flag_rate.sql", events, tmp_path) == [("all", 4, 1, 0.25)]


def test_quiz_takers_and_non_takers_each_get_a_return_rate(tmp_path: Path) -> None:
    week = TODAY - days(14)
    events = [
        *(event("session_started", u, week + days(1)) for u in "abcde"),
        event("quiz_finished", "a", week + days(1)),
        event("quiz_finished", "b", week + days(2)),
        event("session_started", "a", week + days(8)),  # a taker comes back
        event("session_started", "c", week + days(9)),  # a non-taker comes back
        event("quiz_finished", "d", week - days(3)),  # before the week: not a taker
        event("session_started", "g", week + days(1), guest=True),  # guests: out
        event("session_started", "late", week + days(7)),  # not active that week
    ]
    assert run("quiz_return.sql", events, tmp_path) == [
        ("non-takers", 3, 1, 0.3333),
        ("takers", 2, 1, 0.5),
    ]


def test_path_progress_is_sections_passed_per_active_path_last_week(
    tmp_path: Path,
) -> None:
    week = TODAY - days(14)

    def passed(user: str, path: str, section: str, at: datetime) -> dict[str, object]:
        return event(
            "checkpoint_finished",
            user,
            at,
            path_id=path,
            section_id=section,
            passed=True,
        )

    events = [
        # a: started before the week, still active; two sections, one passed twice
        event("path_started", "a", week - days(5), path_id="1"),
        passed("a", "1", "10", week + days(1)),
        passed("a", "1", "10", week + days(2)),
        passed("a", "1", "11", week + days(3)),
        passed("a", "1", "12", week + days(8)),  # after the week: not counted
        # b: paused before the week; resumes another during it, passes nothing
        event("path_started", "b", week - days(6), path_id="2"),
        event("path_paused", "b", week - days(2), path_id="2"),
        event("path_started", "b", week + days(4), path_id="3"),
        # c: a fail doesn't count; paused before the week, a pass on it doesn't either
        event("path_started", "c", week + days(1), path_id="1"),
        event(
            "checkpoint_finished",
            "c",
            week + days(2),
            path_id="1",
            section_id="10",
            passed=False,
        ),
        event("path_started", "c", week - days(9), path_id="4"),
        event("path_paused", "c", week - days(8), path_id="4"),
        passed("c", "4", "40", week + days(2)),
        # e: started before the week and paused during it: active that week
        event("path_started", "e", week - days(3), path_id="6"),
        event("path_paused", "e", week + days(2), path_id="6"),
        passed("e", "6", "60", week + days(1)),
        # f: paused before the week and resumed during it: one active path
        event("path_started", "f", week - days(9), path_id="7"),
        event("path_paused", "f", week - days(4), path_id="7"),
        event("path_started", "f", week + days(3), path_id="7"),
        # d: a developer, active from before the week
        event("path_started", "d", week - days(1), group="developer", path_id="5"),
        passed("d", "5", "50", week + days(5)),
    ]
    # Students: a's path 1 (2), b's 3 (0), c's 1 (0), e's 6 (1), f's 7 (0).
    assert run("path_progress.sql", events, tmp_path) == [
        ("developer", 1, 1, 1.0),
        ("student", 5, 3, 0.6),
    ]


# Phase 3 "done when" (P3-W18-S03; owner, 2026-11-05).


def test_daily_share_is_daily_players_over_that_days_actives(tmp_path: Path) -> None:
    day = TODAY - days(3) + timedelta(hours=9)
    events = [
        *(event("session_started", u, day) for u in "abcd"),
        event("feed_viewed", "e", day),  # active by any event
        event("game_started", "a", day, game="daily"),
        event("game_started", "b", day, game="daily", guest=True),
        event("game_started", "c", day, game="sprint"),  # not the daily one
        # Outside the last 7 full days: today, and 8 days ago.
        event("game_started", "a", TODAY + timedelta(hours=1), game="daily"),
        event("session_started", "z", TODAY - days(8)),
    ]
    assert run("daily_share.sql", events, tmp_path) == [
        ((TODAY - days(3)).date().isoformat(), 5, 2, 0.4)
    ]


def test_match_start_is_the_share_found_within_10_seconds(tmp_path: Path) -> None:
    at = TODAY - days(2)
    events = [
        event("match_found", "a", at, version=2, wait_ms=4_000, opponent="person"),
        event("match_found", "b", at, version=2, wait_ms=10_000, opponent="person"),
        event("match_found", "c", at, version=2, wait_ms=10_400, opponent="bot"),
        event("match_found", "d", at, version=2, wait_ms=6_000, opponent="ghost"),
        # Version 1 had no opponent: only people were found then.
        event("match_found", "e", at, wait_ms=30_000),
        event(
            "match_found", "f", TODAY - days(8), version=2, wait_ms=1, opponent="bot"
        ),
    ]
    assert run("match_start.sql", events, tmp_path) == [
        ("all", 5, 3, 0.6),
        ("bot", 1, 0, 0.0),
        ("ghost", 1, 1, 1.0),
        ("person", 3, 2, 0.6667),
    ]


def test_players_and_non_players_each_get_a_return_rate(tmp_path: Path) -> None:
    week = TODAY - days(10)
    after = TODAY - days(3)
    events = [
        *(event("session_started", u, week) for u in "abcdef"),
        event("session_started", "g", week, guest=True),  # guests left out
        event("game_started", "a", week, game="sprint"),
        event("match_found", "b", week, version=2, wait_ms=3, opponent="person"),
        event("game_started", "c", week, game="daily"),
        *(event("session_started", u, after) for u in "abd"),
    ]
    assert run("player_return.sql", events, tmp_path) == [
        ("non-players", 3, 1, 0.3333),
        ("players", 3, 2, 0.6667),
    ]


def test_a_missed_concept_is_read_within_48_hours(tmp_path: Path) -> None:
    at = TODAY - days(5)

    def missed(user: str, game: str, item: str, moment: str) -> dict[str, object]:
        return event(
            "concept_missed", user, at, game=game, item_id=item, moment_id=moment
        )

    events = [
        missed("a", "sprint", "1", "10"),  # read at 47 h: counts
        event(
            "card_opened", "a", at + timedelta(hours=47), item_id="1", moment_id="10"
        ),
        missed("b", "sprint", "1", "10"),  # read at 49 h: too late
        event(
            "section_finished",
            "b",
            at + timedelta(hours=49),
            item_id="1",
            moment_id="10",
        ),
        missed("c", "live", "1", "10"),  # someone else read it
        event("card_opened", "a", at + timedelta(hours=1), item_id="1", moment_id="10"),
        missed("d", "estimation", "2", "20"),  # another item's open isn't it
        event("card_opened", "d", at + timedelta(hours=2), item_id="3", moment_id="30"),
        missed("e", "daily", "1", "10"),  # another section of the item isn't it
        event("card_opened", "e", at + timedelta(hours=2), item_id="1", moment_id="12"),
        missed("f", "sprint", "1", "10"),  # read before the miss doesn't count
        event("card_opened", "f", at - timedelta(hours=1), item_id="1", moment_id="10"),
        # Too recent for a full 48 h, or too old.
        event(
            "concept_missed",
            "g",
            TODAY - days(1),
            game="sprint",
            item_id="1",
            moment_id="10",
        ),
        event(
            "concept_missed",
            "h",
            TODAY - days(10),
            game="sprint",
            item_id="1",
            moment_id="10",
        ),
    ]
    assert run("missed_read.sql", events, tmp_path) == [
        ("all", 6, 1, 0.1667),
        ("daily", 1, 0, 0.0),
        ("estimation", 1, 0, 0.0),
        ("live", 1, 0, 0.0),
        ("sprint", 3, 1, 0.3333),
    ]


@pytest.mark.parametrize(
    "query",
    [
        "daily_share.sql",
        "match_start.sql",
        "player_return.sql",
        "missed_read.sql",
        # Phase 4 (P4-W24-S02).
        "native_retention.sql",
        "listen_share.sql",
        "explainer_completion.sql",
        "push_opt_in.sql",
    ],
)
def test_phase_3_and_4_queries_give_no_rows_without_events(
    query: str, tmp_path: Path
) -> None:
    assert run(query, [], tmp_path) == []


# Phase 4 (P4-W24-S02, Q-P4-14): native vs web retention; the share of weekly actives
# who listen; explainer completion; push opt-in.
def test_native_retention_splits_by_where_accounts_were_active_in_their_first_week(
    tmp_path: Path,
) -> None:
    events = [
        *(event("signup_completed", u, SIGNUP) for u in ("n1", "n2", "w1", "w2")),
        # n1 and n2 used the app in week one (n2 the web too: still native).
        event("feed_viewed", "n1", SIGNUP + days(1), source="ios"),
        event("feed_viewed", "n2", SIGNUP + days(2), source="android"),
        event("session_started", "n2", SIGNUP + days(2)),
        event("session_started", "w1", SIGNUP + days(1)),
        # Back in week two: n1 from the app (no session_started there), w1 on the web.
        event("feed_viewed", "n1", SIGNUP + days(8), source="ios"),
        event("session_started", "w1", SIGNUP + days(13.9)),
        # The app only after week one doesn't make w2 native; nor is it back in time.
        event("feed_viewed", "w2", SIGNUP + days(14), source="ios"),
        # A coding agent's events in week two aren't a return (§7: no visit).
        event("signup_completed", "w3", SIGNUP),
        event("session_started", "w3", SIGNUP + days(1)),
        event("agent_task_started", "w3", SIGNUP + days(9)),
        # Still in their window: left out.
        event("signup_completed", "new", TODAY - days(10)),
        event("feed_viewed", "new", TODAY - days(9), source="ios"),
    ]
    assert run("native_retention.sql", events, tmp_path) == [
        ("native", 2, 1, 0.5),
        ("web", 3, 1, 0.3333),
    ]


WEEK = TODAY - days(3)


def test_listen_share_is_weekly_actives_who_started_an_explainer(
    tmp_path: Path,
) -> None:
    events = [
        event("feed_viewed", "a", WEEK, source="ios"),
        event("explainer_started", "a", WEEK, explainer_id="7"),
        event("session_started", "b", WEEK),
        event("session_started", "c", WEEK),
        # Listened before the week: not this week's listener, nor active.
        event("explainer_started", "d", TODAY - days(9), explainer_id="7"),
        event("session_started", "g", WEEK, guest=True),
        # Only a coding agent's events: not active.
        event("agent_task_finished", "h", WEEK),
    ]
    assert run("listen_share.sql", events, tmp_path) == [("student", 3, 1, 0.3333)]


LAST_WEEK = TODAY - days(10)


def test_explainer_completion_counts_a_listen_once_and_its_own_finish(
    tmp_path: Path,
) -> None:
    events = [
        event("explainer_started", "a", LAST_WEEK, explainer_id="7"),
        event("explainer_started", "a", LAST_WEEK + days(1), explainer_id="7"),
        event("explainer_finished", "a", LAST_WEEK + days(2), explainer_id="7"),
        event("explainer_started", "b", LAST_WEEK, explainer_id="7"),
        # Another explainer's finish isn't this one's.
        event("explainer_finished", "b", LAST_WEEK, explainer_id="8"),
        event("explainer_started", "c", LAST_WEEK, explainer_id="9"),
        event("explainer_finished", "c", TODAY - days(1), explainer_id="9"),
        # Started this week: still has time, left out.
        event("explainer_started", "d", TODAY - days(2), explainer_id="7"),
        # e finished it once before; this listen, started in the week, never ends.
        event("explainer_finished", "e", LAST_WEEK - days(2), explainer_id="7"),
        event("explainer_started", "e", LAST_WEEK, explainer_id="7"),
    ]
    assert run("explainer_completion.sql", events, tmp_path) == [("student", 4, 2, 0.5)]


def test_push_opt_in_is_weekly_actives_with_a_kind_on_now(tmp_path: Path) -> None:
    def setting(user: str, at: datetime, kind: str, on: bool) -> dict[str, object]:
        return event("push_setting_changed", user, at, kind=kind, on=on)

    events = [
        *(event("session_started", u, WEEK) for u in "abcd"),
        setting("a", TODAY - days(20), "digest", True),
        # b turned the daily challenge on, then off: out.
        setting("b", TODAY - days(5), "daily_challenge", True),
        setting("b", TODAY - days(4), "daily_challenge", False),
        # c turned one off but another stays on: in.
        setting("c", TODAY - days(5), "digest", True),
        setting("c", TODAY - days(4), "path_reminder", True),
        setting("c", TODAY - days(3), "digest", False),
        # d never chose; e opted in before the week and wasn't active in it.
        setting("e", TODAY - days(10), "digest", True),
        # f's turn-off is today's: as of the week, still on.
        event("session_started", "f", WEEK),
        setting("f", TODAY - days(10), "digest", True),
        setting("f", TODAY + days(0.5), "digest", False),
        # A guest with one on is no account.
        event("session_started", "g", WEEK, guest=True),
        event("push_setting_changed", "g", WEEK, guest=True, kind="digest", on=True),
    ]
    assert run("push_opt_in.sql", events, tmp_path) == [("student", 5, 3, 0.6)]


# Phase 5 (P5-W35-S03, Q-P5-19): the share of window registrants matched, per week.
def test_window_matched_sums_each_weeks_groupings(tmp_path: Path) -> None:
    week = TODAY - days(9)
    events = [
        event("battle_window_grouped", "a", week, registered=10, matched=8),
        event(
            "battle_window_grouped",
            "b",
            week + timedelta(hours=3),
            registered=6,
            matched=6,
        ),
        event("battle_window_grouped", "c", TODAY - days(70), registered=4, matched=0),
    ]
    rows = run("window_matched.sql", events, tmp_path)
    assert [(r[1], r[2], round(r[3], 4)) for r in rows] == [(16, 14, 0.875)]


def test_window_matched_gives_no_rows_without_events(tmp_path: Path) -> None:
    assert run("window_matched.sql", [], tmp_path) == []
