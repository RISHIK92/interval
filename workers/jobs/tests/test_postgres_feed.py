"""Postgres per-user feeds (CACHE-1, P1-W4-S04): the *_visible views, their gate,
cascades, and the per-user lock."""

import os
import threading
import time
from datetime import UTC, datetime
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql

from interval_jobs.adapters.postgres import PostgresStore
from interval_jobs.ports import RankedMoment


def add_item(
    conn: psycopg.Connection,
    source_id: int,
    guid: str,
    published: datetime,
    sections: int,
) -> int:
    row = conn.execute(
        "insert into content_item "
        "(source_id, guid, canonical_url, title, published_at) "
        "values (%s, %s, %s, %s, %s) returning id",
        (
            source_id,
            guid,
            f"https://feed.example.test/{guid}",
            f"Article {guid}",
            published,
        ),
    ).fetchone()
    assert row is not None
    item_id: int = row[0]
    for ordinal in range(sections):
        conn.execute(
            "insert into moment "
            "(content_item_id, ordinal, title, estimated_minutes, link, link_type) "
            "values (%s, %s, %s, 1, %s, 'page_top')",
            (
                item_id,
                ordinal,
                f"{guid} s{ordinal}",
                f"https://feed.example.test/{guid}",
            ),
        )
    return item_id


def source(conn: psycopg.Connection, name: str) -> int:
    source_id = PostgresStore(conn).sources.upsert(
        name=name,
        feed_url=f"https://feed.example.test/{name}.xml",
        rights_profile="full_text_internal",
        homepage=None,
    )
    conn.execute(
        "update source set moments_seeded = true, moments_enabled = true where id = %s",
        (source_id,),
    )
    return source_id


def user(conn: psycopg.Connection) -> str:
    user_id = f"feedtest-{uuid4().hex[:8]}"
    row = conn.execute(
        "insert into invite_code (code, beta_group, max_uses, expires_at) "
        "values (%s, 'student', 1, now() + interval '1 day') returning id",
        (f"FEEDTEST{uuid4().hex[:8].upper()}",),
    ).fetchone()
    assert row is not None
    conn.execute(
        "insert into app_user (id, name, email, beta_group, invite_code_id) "
        "values (%s, 'n', %s, 'student', %s)",
        (user_id, f"{user_id}@example.test", row[0]),
    )
    return user_id


def moments_of(conn: psycopg.Connection, item_id: int) -> list[int]:
    rows = conn.execute(
        "select id from moment where content_item_id = %s order by ordinal", (item_id,)
    ).fetchall()
    return [r[0] for r in rows]


def give(conn: psycopg.Connection, user_id: str, moment_ids: list[int]) -> None:
    PostgresStore(conn).feed.replace_user(
        user_id,
        [RankedMoment(m, "topic_match") for m in moment_ids],
        datetime.now(UTC),
    )


def visible(conn: psycopg.Connection, user_id: str) -> list[tuple[str, int, int]]:
    return conn.execute(
        "select section_title, section_number, section_count from user_feed_visible "
        "where user_id = %s order by rank",
        (user_id,),
    ).fetchall()


def test_a_user_sees_their_own_feed_in_rank_order(conn: psycopg.Connection) -> None:
    src = source(conn, "feedtest-a")
    item = add_item(conn, src, "one", datetime(2026, 10, 1, tzinfo=UTC), 2)
    first, second = moments_of(conn, item)
    me, other = user(conn), user(conn)
    give(conn, me, [second, first])
    give(conn, other, [first])
    assert visible(conn, me) == [("one s1", 2, 2), ("one s0", 1, 2)]
    assert visible(conn, other) == [("one s0", 1, 2)]


def test_switching_moments_off_cascades_to_every_feed(conn: psycopg.Connection) -> None:
    src = source(conn, "feedtest-c")
    item = add_item(conn, src, "one", datetime(2026, 10, 1, tzinfo=UTC), 2)
    me = user(conn)
    give(conn, me, moments_of(conn, item))
    PostgresStore(conn).feed.replace_starter(
        "databases",
        "beginner",
        [RankedMoment(m, "quality") for m in moments_of(conn, item)],
    )
    conn.execute(
        "update source set moments_seeded = false, moments_enabled = false "
        "where id = %s",
        (src,),
    )
    # No recompute: the purge trigger deletes the moments and the entries cascade.
    assert visible(conn, me) == []
    left = conn.execute(
        "select count(*) from starter_feed_entry where topic = 'databases' "
        "and level = 'beginner'"
    ).fetchone()
    assert left == (0,)


def test_section_count_covers_moments_left_out_of_the_feed(
    conn: psycopg.Connection,
) -> None:
    src = source(conn, "feedtest-e")
    item = add_item(conn, src, "one", datetime(2026, 10, 1, tzinfo=UTC), 3)
    me = user(conn)
    give(conn, me, moments_of(conn, item)[1:2])
    assert visible(conn, me) == [("one s1", 2, 3)]


@pytest.mark.parametrize(
    "change",
    [
        # The admin switch: moments_enabled follows it (P1-W3-S06).
        {"moments_switched_off": True, "moments_enabled": False},
        {"rights_profile": "excerpt"},
        {"rights_profile": "metadata_only"},
    ],
)
def test_views_hide_stale_entries_when_the_source_no_longer_allows_moments(
    conn: psycopg.Connection, change: dict[str, object]
) -> None:
    src = source(conn, "feedtest-d")
    item = add_item(conn, src, "one", datetime(2026, 10, 1, tzinfo=UTC), 1)
    me = user(conn)
    give(conn, me, moments_of(conn, item))
    PostgresStore(conn).feed.replace_starter(
        "databases",
        "advanced",
        [RankedMoment(m, "quality") for m in moments_of(conn, item)],
    )
    # Skip triggers for this transaction only, to leave stale feed entries behind.
    conn.execute("set local session_replication_role = replica")
    conn.execute(
        sql.SQL("update source set {} where id = %s").format(
            sql.SQL(", ").join(
                sql.SQL("{} = %s").format(sql.Identifier(column)) for column in change
            )
        ),
        (*change.values(), src),
    )
    conn.execute("set local session_replication_role = origin")
    assert visible(conn, me) == []
    starter = conn.execute(
        "select count(*) from starter_feed_visible where source_name = 'feedtest-d'"
    ).fetchone()
    assert starter == (0,)


def test_two_recomputes_of_one_user_wait_for_each_other(
    conn: psycopg.Connection,
) -> None:
    url = os.environ["DATABASE_URL"]
    with psycopg.connect(url) as setup:
        me = user(setup)
        setup.commit()
    try:
        with psycopg.connect(url) as first, psycopg.connect(url) as second:
            # Inside an open transaction, as in the worker's unit of work: the lock is
            # held until that commits.
            first.execute("select 1")
            give(first, me, [])
            result: list[BaseException | None] = []

            def run_second() -> None:
                try:
                    give(second, me, [])
                    second.commit()
                    result.append(None)
                except BaseException as error:
                    result.append(error)

            worker = threading.Thread(target=run_second)
            worker.start()
            time.sleep(0.3)
            assert result == []  # blocked on the per-user advisory lock
            first.commit()
            worker.join(timeout=5)
            assert result == [None]
    finally:
        with psycopg.connect(url) as cleanup:
            cleanup.execute("delete from app_user where id = %s", (me,))
