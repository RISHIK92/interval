"""The book_process stage (§5F, ING-5, P2-W11-S02) on fakes: a PDF into chapters and
sessions, or failed with a reason the user sees."""

import threading
from collections.abc import Generator
from contextlib import contextmanager

from interval_jobs.adapters.memory import InMemoryFiles, InMemoryStore, StoredBook
from interval_jobs.adapters.memory_queue import InMemoryQueue
from interval_jobs.adapters.trafilatura_extractor import TrafilaturaExtractor
from interval_jobs.books.process import (
    NOT_ON_PLAN,
    PROTECTED,
    UNREADABLE,
    too_many_pages,
)
from interval_jobs.pipeline import Pipeline, StageServices

from .pdf_builder import Spec, TextLine, build
from .test_pipeline import web

KEY = "books/u1/0b0e3c2a-6d0c-4c4b-9a8e-2f8f0c6a1b2c.pdf"
VOCAB = "leader follower quorum replica write read log commit term vote".split()


def body(n_lines: int, seed: int) -> list[TextLine]:
    # Varied text: identical lines on many pages are dropped as running headers.
    return [
        TextLine(" ".join(VOCAB[(seed + i + j) % 10] + str(j) for j in range(12)))
        for i in range(n_lines)
    ]


def run(store: InMemoryStore, files: InMemoryFiles) -> None:
    queue = InMemoryQueue()

    @contextmanager
    def unit() -> Generator[StageServices]:
        yield StageServices(store, web(), TrafilaturaExtractor())

    pipeline = Pipeline(unit, queue, files=files)
    queue.enqueue("book_process", {"book_id": 1}, idempotency_key="book-1")
    queue.consume(
        "book_process", pipeline.handlers()["book_process"], threading.Event()
    )


def world(data: bytes) -> tuple[InMemoryStore, InMemoryFiles]:
    store, files = InMemoryStore(), InMemoryFiles()
    store.books.rows[1] = StoredBook(user_id="u1", file_key=KEY, title="ddia")
    store.books.max_pages_by_user["u1"] = 1000  # the beta plan (Q-P2-34)
    files.stored[KEY] = data
    return store, files


def test_a_digital_pdf_becomes_chapters_and_sessions() -> None:
    data = build(
        Spec(
            pages=[
                [TextLine("Replication", 24), *body(30, 1)],
                [*body(35, 2)],
                [TextLine("Partitioning", 24), *body(30, 3)],
            ],
            outline=[("Replication", 1), ("Partitioning", 3)],
            title="Designing Data-Intensive Applications",
        )
    )
    store, files = world(data)
    run(store, files)
    book = store.books.rows[1]
    assert book.status == "ready"
    assert book.title == "Designing Data-Intensive Applications"
    assert book.page_count == 3
    assert [c.title for c in book.chapters] == ["Replication", "Partitioning"]
    assert all(s.minutes >= 1 for c in book.chapters for s in c.sessions)
    assert [p.scanned for p in book.pages] == [False, False, False]
    # A second delivery (LOAD-5) leaves it as it is.
    run(store, files)
    assert [c.title for c in store.books.rows[1].chapters] == [
        "Replication",
        "Partitioning",
    ]


def test_a_scanned_page_waits_for_ocr() -> None:
    store, files = world(build(Spec(pages=[body(20, 1), []])))
    run(store, files)
    book = store.books.rows[1]
    assert book.status == "ocr"
    assert [p.scanned for p in book.pages] == [False, True]
    assert book.chapters == []


def test_protected_unreadable_and_too_long_fail_with_their_reason() -> None:
    store, files = world(build(Spec(pages=[body(5, 1)], encrypted=True)))
    run(store, files)
    assert store.books.rows[1].failure == PROTECTED

    store, files = world(b"%PDF-1.4\nnot a pdf")
    run(store, files)
    assert store.books.rows[1].failure == UNREADABLE

    store, files = world(build(Spec(pages=[body(5, 1), body(5, 2), body(5, 3)])))
    store.books.max_pages_by_user["u1"] = 2
    run(store, files)
    assert store.books.rows[1].status == "failed"
    assert store.books.rows[1].failure == too_many_pages(2) == "Over 2 pages."


def test_a_book_deleted_meanwhile_is_left_alone() -> None:
    store, files = world(b"")
    del store.books.rows[1]
    run(store, files)
    assert store.books.rows == {}


def test_a_plan_without_books_fails_with_its_own_reason() -> None:
    store, files = world(build(Spec(pages=[body(5, 1)])))
    store.books.max_pages_by_user["u1"] = 0
    run(store, files)
    assert store.books.rows[1].failure == NOT_ON_PLAN
