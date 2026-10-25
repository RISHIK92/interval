import os
import threading
import time
from datetime import UTC, datetime

import psycopg
import pytest
from psycopg import sql

from interval_jobs.feed.precompute import rebuild_feed
from interval_jobs.sources import upsert_source


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
    source_id = upsert_source(
        conn,
        name=name,
        feed_url=f"https://feed.example.test/{name}.xml",
        rights_profile="full_text_internal",
        homepage=None,
    )
    conn.execute("update source set moments_enabled = true where id = %s", (source_id,))
    return source_id


def visible(conn: psycopg.Connection) -> list[tuple[str, int, int]]:
    return conn.execute(
        "select section_title, section_number, section_count from feed_visible "
        "where source_name like 'feedtest-%%' order by rank"
    ).fetchall()


def test_newest_item_first_then_sections_in_order(conn: psycopg.Connection) -> None:
    src = source(conn, "feedtest-a")
    add_item(conn, src, "old", datetime(2026, 10, 1, tzinfo=UTC), 2)
    add_item(conn, src, "new", datetime(2026, 10, 20, tzinfo=UTC), 2)
    rebuild_feed(conn)

    assert visible(conn) == [
        ("new s0", 1, 2),
        ("new s1", 2, 2),
        ("old s0", 1, 2),
        ("old s1", 2, 2),
    ]


def test_rebuilding_replaces_entries(conn: psycopg.Connection) -> None:
    src = source(conn, "feedtest-b")
    add_item(conn, src, "one", datetime(2026, 10, 1, tzinfo=UTC), 3)
    rebuild_feed(conn)
    rebuild_feed(conn)
    assert len(visible(conn)) == 3


def test_switching_moments_off_cascades_to_the_feed(conn: psycopg.Connection) -> None:
    src = source(conn, "feedtest-c")
    add_item(conn, src, "one", datetime(2026, 10, 1, tzinfo=UTC), 2)
    rebuild_feed(conn)
    conn.execute("update source set moments_enabled = false where id = %s", (src,))
    # No rebuild: the purge trigger deletes the moments and feed_entry cascades.
    assert visible(conn) == []


def test_section_count_covers_moments_left_out_of_the_feed(
    conn: psycopg.Connection,
) -> None:
    src = source(conn, "feedtest-e")
    add_item(conn, src, "one", datetime(2026, 10, 1, tzinfo=UTC), 3)
    rebuild_feed(conn)
    conn.execute(
        "delete from feed_entry where moment_id in (select id from moment where title "
        "in ('one s0', 'one s2'))"
    )
    assert visible(conn) == [("one s1", 2, 3)]


@pytest.mark.parametrize(
    ("column", "value"),
    [
        ("moments_enabled", False),
        ("rights_profile", "excerpt"),
        ("rights_profile", "metadata_only"),
    ],
)
def test_view_hides_stale_entries_when_the_source_no_longer_allows_moments(
    conn: psycopg.Connection, column: str, value: object
) -> None:
    src = source(conn, "feedtest-d")
    add_item(conn, src, "one", datetime(2026, 10, 1, tzinfo=UTC), 1)
    rebuild_feed(conn)
    # Skip triggers for this transaction only, to leave a stale feed entry behind.
    conn.execute("set local session_replication_role = replica")
    conn.execute(
        sql.SQL("update source set {} = %s where id = %s").format(
            sql.Identifier(column)
        ),
        (value, src),
    )
    conn.execute("set local session_replication_role = origin")
    assert visible(conn) == []


def test_concurrent_rebuilds_wait_for_each_other(conn: psycopg.Connection) -> None:
    url = os.environ["DATABASE_URL"]
    with psycopg.connect(url) as first, psycopg.connect(url) as second:
        rebuild_feed(first)
        result: list[BaseException | int] = []

        def run_second() -> None:
            try:
                result.append(rebuild_feed(second))
                second.commit()
            except BaseException as error:
                result.append(error)

        worker = threading.Thread(target=run_second)
        worker.start()
        time.sleep(0.3)
        assert result == []  # blocked on the advisory lock
        first.commit()
        worker.join(timeout=5)
        assert len(result) == 1
        assert isinstance(result[0], int)
