"""PostgresBooks (P2-W11-S02) on the real schema: what the stage reads and writes."""

import psycopg

from interval_jobs.adapters.postgres import PostgresBooks
from interval_jobs.ports import BookChapterRow, BookPageText, BookSessionRow

from .test_db_guards import a_user


def a_book(conn: psycopg.Connection, user_id: str) -> int:
    a_user(conn, user_id)
    row = conn.execute(
        "insert into book (user_id, title, file_key, size_bytes) "
        "values (%s, 'ddia', %s, 100) returning id",
        (user_id, f"books/{user_id}/x.pdf"),
    ).fetchone()
    assert row is not None
    return int(row[0])


CHAPTERS = [
    BookChapterRow(
        "Replication",
        [
            BookSessionRow("Leaders", "One node takes writes.", 3, 1),
            BookSessionRow("Followers", "Others copy them.", 4, 2),
        ],
    ),
    BookChapterRow("Partitioning", [BookSessionRow("Keys", "Split by key.", 2, 3)]),
]
PAGES = [BookPageText(n, f"page {n}", False) for n in (1, 2, 3)]


def test_a_processed_book_is_saved_and_a_rerun_replaces_it(
    conn: psycopg.Connection,
) -> None:
    books = PostgresBooks(conn)
    book_id = a_book(conn, "bk1")
    job = books.for_processing(book_id)
    assert job is not None and (job.user_id, job.title) == ("bk1", "ddia")
    assert books.max_pages("bk1") == 1000  # the beta plan (Q-P2-34)
    books.save(
        book_id, "Designing Data-Intensive Applications", PAGES, CHAPTERS, "ready"
    )
    # Done: no longer waiting to be processed.
    assert books.for_processing(book_id) is None
    assert conn.execute(
        "select title, status, page_count, failure from book where id = %s",
        (book_id,),
    ).fetchone() == ("Designing Data-Intensive Applications", "ready", 3, None)
    rows = conn.execute(
        "select c.ordinal, c.title, s.ordinal, s.title, s.estimated_minutes, "
        "s.first_page from book_session s join book_chapter c on c.id = s.chapter_id "
        "where c.book_id = %s order by c.ordinal, s.ordinal",
        (book_id,),
    ).fetchall()
    assert rows == [
        (0, "Replication", 0, "Leaders", 3, 1),
        (0, "Replication", 1, "Followers", 4, 2),
        (1, "Partitioning", 0, "Keys", 2, 3),
    ]
    # Saving again (S03's rebuild after OCR) replaces, never duplicates; no title
    # keeps the one there.
    books.save(book_id, None, PAGES[:1], CHAPTERS[:1], "ready")
    assert conn.execute(
        "select count(*) from book_page where book_id = %s", (book_id,)
    ).fetchone() == (1,)
    assert conn.execute(
        "select count(*) from book_chapter where book_id = %s", (book_id,)
    ).fetchone() == (1,)
    assert conn.execute(
        "select title from book where id = %s", (book_id,)
    ).fetchone() == ("Designing Data-Intensive Applications",)


def test_a_failure_keeps_its_reason_and_a_deleted_book_takes_everything(
    conn: psycopg.Connection,
) -> None:
    books = PostgresBooks(conn)
    book_id = a_book(conn, "bk2")
    books.fail(book_id, "Protected PDFs can't be read.")
    assert conn.execute(
        "select status, failure from book where id = %s", (book_id,)
    ).fetchone() == ("failed", "Protected PDFs can't be read.")
    assert books.for_processing(book_id) is None

    other = a_book(conn, "bk3")
    books.save(other, None, PAGES, CHAPTERS, "ready")
    sessions = [
        r[0]
        for r in conn.execute(
            "select s.id from book_session s join book_chapter c "
            "on c.id = s.chapter_id where c.book_id = %s",
            (other,),
        ).fetchall()
    ]
    assert len(sessions) == 3
    conn.execute("delete from book where id = %s", (other,))
    assert conn.execute(
        "select (select count(*) from book_page where book_id = %s), "
        "(select count(*) from book_chapter where book_id = %s), "
        "(select count(*) from book_session where id = any(%s))",
        (other, other, sessions),
    ).fetchone() == (0, 0, 0)


def test_no_grant_is_no_pages_and_a_null_limit_is_no_limit(
    conn: psycopg.Connection,
) -> None:
    books = PostgresBooks(conn)
    a_user(conn, "bk4")
    conn.execute(
        "update plan_capability set limit_value = null "
        "where plan_id = 'beta' and capability = 'books.max_pages'"
    )
    assert books.max_pages("bk4") is None
    conn.execute(
        "delete from plan_capability "
        "where plan_id = 'beta' and capability = 'books.max_pages'"
    )
    assert books.max_pages("bk4") == 0
