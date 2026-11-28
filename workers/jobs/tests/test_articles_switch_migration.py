"""ADR-0058 stage B: the workers' switch migration, on the real file: inside the test's
rolled-back transaction its down step runs, moment-era rows go in, and its up step runs
again."""

from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

import psycopg
import pytest

from .test_articles_expand_migration import Article, retrying, row_id

MIGRATION = (
    Path(__file__).parents[3]
    / "packages/db/migrations/20261127310000_articles_switch_workers.sql"
)
Switched = Callable[[Callable[[Article], None]], Article]


def _steps() -> tuple[str, str]:
    text = MIGRATION.read_text()
    up, down = text.split("-- migrate:down", 1)
    return up.split("-- migrate:up", 1)[1], down


@pytest.fixture
def switched(conn: psycopg.Connection) -> Switched:
    def run(before: Callable[[Article], None]) -> Article:
        up, down = _steps()
        retrying(conn, down)
        article = Article(conn, moments=3)
        before(article)
        retrying(conn, up)
        return article

    return run


def _section(conn: psycopg.Connection) -> int:
    path = row_id(
        conn,
        "insert into path (name, why, status, model, prompt_version) "
        "values ('P', 'why', 'live', 'm', 1) returning id",
    )
    return row_id(
        conn,
        "insert into path_section (path_id, ordinal) values (%s, 0) returning id",
        (path,),
    )


def test_two_moments_of_one_article_in_a_section_become_its_first_session(
    conn: psycopg.Connection, switched: Switched
) -> None:
    sections: list[int] = []
    other: list[int] = []

    def before(a: Article) -> None:
        section = _section(conn)
        sections.append(section)
        b = Article(conn, moments=1)
        other.append(b.id)
        for ordinal, moment in enumerate([a.moments[0], a.moments[1], b.moments[0]]):
            conn.execute(
                "insert into path_session (section_id, ordinal, moment_id) "
                "values (%s, %s, %s)",
                (section, ordinal, moment),
            )
        # The user swapped session 2 onto the article's last moment, and session 1
        # (the duplicate, which goes) onto b.
        conn.execute(
            "insert into user_path_session (user_id, section_id, ordinal, moment_id) "
            "values (%s, %s, 2, %s), (%s, %s, 1, %s)",
            (a.user, section, a.moments[2], a.user, section, b.moments[0]),
        )

    a = switched(before)
    (section,) = sections
    sessions = conn.execute(
        "select ordinal, content_item_id from path_session where section_id = %s "
        "order by ordinal",
        (section,),
    ).fetchall()
    assert sessions == [(0, a.id), (2, other[0])]
    mine = conn.execute(
        "select ordinal, content_item_id from user_path_session where section_id = %s",
        (section,),
    ).fetchall()
    assert mine == [(2, a.id)]
    # The user's copy names the article once, at its first place.
    assert conn.execute(
        "select ordinal, content_item_id from user_path_articles(%s, %s) "
        "order by ordinal",
        (a.user, section),
    ).fetchall() == [(0, a.id)]


def test_the_last_open_is_the_latest_moment_open_or_finish_and_follows_them(
    conn: psycopg.Connection, switched: Switched
) -> None:
    def at(day: int) -> datetime:
        return datetime(2026, 11, day, tzinfo=UTC)

    def before(a: Article) -> None:
        conn.execute(
            "insert into user_moment_opened (user_id, moment_id, opened_at) "
            "values (%s, %s, %s), (%s, %s, %s)",
            (a.user, a.moments[0], at(1), a.user, a.moments[1], at(5)),
        )
        conn.execute(
            "insert into user_moment_finished (user_id, moment_id, method, "
            "finished_at) values (%s, %s, 'mark_done', %s)",
            (a.user, a.moments[2], at(3)),
        )

    a = switched(before)
    query = (
        "select opened_at, last_opened_at from user_article_opened "
        "where user_id = %s and content_item_id = %s"
    )
    assert conn.execute(query, (a.user, a.id)).fetchone() == (at(1), at(5))
    # Opens written by moment meanwhile (stage A's trigger) move it on, never back.
    conn.execute("delete from user_moment_opened where user_id = %s", (a.user,))
    conn.execute(
        "insert into user_moment_opened (user_id, moment_id, opened_at) "
        "values (%s, %s, %s)",
        (a.user, a.moments[0], at(9)),
    )
    assert conn.execute(query, (a.user, a.id)).fetchone() == (at(1), at(9))
    conn.execute(
        "insert into user_moment_opened (user_id, moment_id, opened_at) "
        "values (%s, %s, %s)",
        (a.user, a.moments[1], at(7)),
    )
    assert conn.execute(query, (a.user, a.id)).fetchone() == (at(1), at(9))
