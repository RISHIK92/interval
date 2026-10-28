"""PostgresBooks (P2-W11-S02) on the real schema: what the stage reads and writes."""

import os
import threading
import time
from datetime import UTC, datetime

import psycopg
import pytest

from interval_jobs.adapters.postgres import PostgresBooks, PostgresQuestions
from interval_jobs.ports import (
    BookChapterRow,
    BookPageText,
    BookQuestion,
    BookSessionRow,
    QuestionDraft,
)

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
            BookSessionRow("Leaders", "One node takes writes.", 3, 1, 2),
            BookSessionRow("Followers", "Others copy them.", 4, 2, 3),
        ],
    ),
    BookChapterRow("Partitioning", [BookSessionRow("Keys", "Split by key.", 2, 3, 3)]),
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
        "s.first_page, s.last_page from book_session s "
        "join book_chapter c on c.id = s.chapter_id "
        "where c.book_id = %s order by c.ordinal, s.ordinal",
        (book_id,),
    ).fetchall()
    assert rows == [
        (0, "Replication", 0, "Leaders", 3, 1, 2),
        (0, "Replication", 1, "Followers", 4, 2, 3),
        (1, "Partitioning", 0, "Keys", 2, 3, 3),
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


# P2-W11-S03 (ADR-0022): scanned pages, read one at a time.
def test_ocr_pages_are_counted_down_and_only_unread_scanned_pages_wait(
    conn: psycopg.Connection,
) -> None:
    books = PostgresBooks(conn)
    book_id = a_book(conn, "bk5")
    pages = [
        BookPageText(1, "digital", False),
        BookPageText(2, "", True),
        BookPageText(3, "", True),
    ]
    books.save(book_id, None, pages, [], "ocr")
    assert books.for_ocr(book_id, 1) is None  # not scanned
    assert books.for_ocr(book_id, 2) is not None
    assert books.record_ocr(book_id, 2, "two") == 1
    assert books.for_ocr(book_id, 2) is None  # read
    assert books.record_ocr(book_id, 3, "three") == 0
    assert [p.text for p in books.pages(book_id)] == ["digital", "two", "three"]
    # Built: no page waits any more.
    books.save(book_id, None, books.pages(book_id), CHAPTERS, "ready")
    assert books.for_ocr(book_id, 3) is None


def test_two_last_pages_at_once_leave_exactly_one_to_build_the_book() -> None:
    url = os.environ["DATABASE_URL"]
    with psycopg.connect(url, autocommit=True) as setup:
        a_user(setup, "bk6")
        row = setup.execute(
            "insert into book (user_id, title, file_key, size_bytes, status) "
            "values ('bk6', 't', 'books/bk6/x.pdf', 1, 'ocr') returning id"
        ).fetchone()
        assert row is not None
        book_id = int(row[0])
        setup.execute(
            "insert into book_page (book_id, page_no, text, scanned) "
            "values (%s, 1, '', true), (%s, 2, '', true)",
            (book_id, book_id),
        )
    left: list[int | None] = []
    barrier = threading.Barrier(2)

    def read(page_no: int) -> None:
        with psycopg.connect(url) as conn, conn.transaction():
            barrier.wait()
            left.append(PostgresBooks(conn).record_ocr(book_id, page_no, "text"))
            time.sleep(0.2)  # hold the lock, as building the book would

    try:
        threads = [threading.Thread(target=read, args=(n,)) for n in (1, 2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert sorted(n for n in left if n is not None) == [0, 1]
    finally:
        with psycopg.connect(url, autocommit=True) as cleanup:
            cleanup.execute("delete from app_user where id = 'bk6'")
            cleanup.execute("delete from invite_code where code = %s", ("PLANCODEBK6",))


def test_a_deleted_book_or_a_page_read_twice_records_nothing(
    conn: psycopg.Connection,
) -> None:
    books = PostgresBooks(conn)
    book_id = a_book(conn, "bk7")
    books.save(
        book_id,
        None,
        [BookPageText(1, "", True), BookPageText(2, "", True)],
        [],
        "ocr",
    )
    assert books.unread_scanned(book_id) == [1, 2]
    assert books.record_ocr(book_id, 1, "one") == 1
    # A second delivery of the same page: nothing, so no second build either.
    assert books.record_ocr(book_id, 1, "again") is None
    assert books.unread_scanned(book_id) == [2]
    conn.execute("delete from book where id = %s", (book_id,))
    assert books.record_ocr(book_id, 2, "two") is None
    assert books.unread_scanned(book_id) == []


# P2-W11-S06 (Q-P2-35): a chapter's checkpoint, made on demand.
def _preparing(conn: psycopg.Connection, user_id: str) -> int:
    book_id = a_book(conn, user_id)
    PostgresBooks(conn).save(book_id, None, PAGES, CHAPTERS, "ready")
    row = conn.execute(
        "select id from book_chapter where book_id = %s and ordinal = 0", (book_id,)
    ).fetchone()
    assert row is not None
    conn.execute(
        "insert into book_chapter_checkpoint (chapter_id) values (%s)", (row[0],)
    )
    conn.execute(
        "insert into concept (slug, name, topic) values "
        "('bk-leaders', 'Leaders', 'databases') on conflict do nothing"
    )
    return int(row[0])


def _question(answer: int | None) -> BookQuestion:
    draft = QuestionDraft(
        "Who takes writes?", ("One node", "All", "None", "Any"), 0, "x"
    )
    return BookQuestion(draft, frozenset({"bk-leaders"}), answer, "beginner", "h")


def test_a_checkpoint_is_read_while_preparing_and_saved_ready_with_its_concepts(
    conn: psycopg.Connection,
) -> None:
    books = PostgresBooks(conn)
    chapter_id = _preparing(conn, "bk6")
    wanted = books.checkpoint_input(chapter_id)
    assert wanted is not None
    assert (wanted.user_id, wanted.book_title, wanted.title) == (
        "bk6",
        "ddia",
        "Replication",
    )
    assert wanted.sessions == [
        ("Leaders", "One node takes writes."),
        ("Followers", "Others copy them."),
    ]
    assert (
        books.save_checkpoint(
            chapter_id,
            frozenset({"bk-leaders"}),
            [_question(0), _question(2)],
            "g",
            "v",
        )
        == "ready"
    )
    assert conn.execute(
        "select status, failure from book_chapter_checkpoint where chapter_id = %s",
        (chapter_id,),
    ).fetchone() == ("ready", None)
    rows = conn.execute(
        "select q.moment_id, q.ordinal, q.status, q.validator_answer, "
        "array(select c.slug from question_concept qc join concept c "
        "on c.id = qc.concept_id where qc.question_id = q.id) "
        "from question q where q.book_chapter_id = %s order by q.ordinal",
        (chapter_id,),
    ).fetchall()
    assert rows == [
        (None, 0, "live", 0, ["bk-leaders"]),
        (None, 1, "rejected", 2, ["bk-leaders"]),
    ]
    assert conn.execute(
        "select c.slug from book_chapter_concept bc join concept c "
        "on c.id = bc.concept_id where bc.chapter_id = %s",
        (chapter_id,),
    ).fetchall() == [("bk-leaders",)]
    # Ready now: not read again, and a second run's save stores nothing.
    assert books.checkpoint_input(chapter_id) is None
    assert (
        books.save_checkpoint(chapter_id, frozenset(), [_question(1)], "g", "v")
        == "gone"
    )
    assert conn.execute(
        "select count(*) from question where book_chapter_id = %s", (chapter_id,)
    ).fetchone() == (2,)
    assert conn.execute(
        "select count(*) from book_chapter_concept where chapter_id = %s",
        (chapter_id,),
    ).fetchone() == (1,)


def test_no_live_question_leaves_it_to_fail_and_a_retry_replaces_the_drafts(
    conn: psycopg.Connection,
) -> None:
    books = PostgresBooks(conn)
    chapter_id = _preparing(conn, "bk7")
    assert (
        books.save_checkpoint(
            chapter_id, frozenset(), [_question(1), _question(None)], "g", "v"
        )
        == "empty"
    )
    books.fail_checkpoint(chapter_id, "Couldn't make questions for this chapter.")
    assert conn.execute(
        "select status from book_chapter_checkpoint where chapter_id = %s",
        (chapter_id,),
    ).fetchone() == ("failed",)
    # Asked again (the web resets it to preparing): the rejected drafts are replaced.
    conn.execute(
        "update book_chapter_checkpoint set status = 'preparing', failure = null "
        "where chapter_id = %s",
        (chapter_id,),
    )
    assert (
        books.save_checkpoint(chapter_id, frozenset(), [_question(0)], "g", "v")
        == "ready"
    )
    assert conn.execute(
        "select ordinal, status from question where book_chapter_id = %s",
        (chapter_id,),
    ).fetchall() == [(0, "live")]


def test_a_question_has_one_home(conn: psycopg.Connection) -> None:
    with pytest.raises(psycopg.errors.CheckViolation):
        conn.execute(
            "insert into question (ordinal, stem, options, correct, citation, "
            "generator_model, prompt_version, content_hash) "
            "values (0, 's', array['a','b','c','d'], 0, 'c', 'g', 1, 'h')"
        )


def test_a_chapters_questions_never_reach_the_admin_review(
    conn: psycopg.Connection,
) -> None:
    books = PostgresBooks(conn)
    chapter_id = _preparing(conn, "bk9")
    books.save_checkpoint(
        chapter_id, frozenset(), [_question(0), _question(0)], "g", "v"
    )
    ids = [
        int(r[0])
        for r in conn.execute(
            "select id from question where book_chapter_id = %s order by ordinal",
            (chapter_id,),
        ).fetchall()
    ]
    conn.execute("update question set status = 'flagged' where id = %s", (ids[1],))
    PostgresQuestions(conn).queue_spot_checks(datetime(2000, 1, 1, tzinfo=UTC), 1.0)
    assert conn.execute(
        "select count(*) from question_review where question_id = any(%s)", (ids,)
    ).fetchone() == (0,)
