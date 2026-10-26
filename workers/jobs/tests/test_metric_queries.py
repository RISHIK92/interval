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
PROPS = "STRUCT(kind VARCHAR, item_id VARCHAR, moment_id VARCHAR, method VARCHAR)"

type Row = tuple[str, int, int, float]


def event(
    name: str,
    user: str,
    at: datetime,
    group: str = "student",
    guest: bool = False,
    version: int = 1,
    **props: str | None,
) -> dict[str, object]:
    return {
        "event_id": str(uuid4()),
        "occurred_at": at.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "user_id": user,
        "is_guest": guest,
        "beta_group": group,
        "session_id": None,
        "source": "web",
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
