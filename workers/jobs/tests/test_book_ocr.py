"""Scanned pages through the OCR service (ADR-0022, ING-5, P2-W11-S03), on fakes."""

import threading
from collections.abc import Generator
from contextlib import contextmanager

import pytest
from pydantic import BaseModel

from interval_db.messages import BookProcess, OcrPage
from interval_jobs.adapters.memory import (
    InMemoryFiles,
    InMemoryOcr,
    InMemoryStore,
    StoredBook,
)
from interval_jobs.adapters.memory_queue import InMemoryQueue
from interval_jobs.adapters.trafilatura_extractor import TrafilaturaExtractor
from interval_jobs.books.ocr import GAVE_UP, MAX_PIXELS
from interval_jobs.books.pdf import UnreadablePdf, open_pdf, render
from interval_jobs.pipeline import Pipeline, StageServices
from interval_jobs.ports import Delivery
from interval_jobs.queue import ATTEMPTS

from .pdf_builder import Spec, TextLine, build
from .test_book_process import KEY, body
from .test_pipeline import web

OCR_TEXT = "\n".join(
    " ".join(f"scanned{w}{line}" for w in "abcdefghijkl") for line in "abcdefghijklmnop"
)


def setup(
    data: bytes, ocr: InMemoryOcr
) -> tuple[InMemoryStore, InMemoryFiles, InMemoryQueue, Pipeline]:
    store, files, queue = InMemoryStore(), InMemoryFiles(), InMemoryQueue()
    store.books.rows[1] = StoredBook(user_id="u1", file_key=KEY, title="notes")
    store.books.max_pages_by_user["u1"] = 1000
    files.stored[KEY] = data

    @contextmanager
    def unit() -> Generator[StageServices]:
        yield StageServices(store, web(), TrafilaturaExtractor())

    return store, files, queue, Pipeline(unit, queue, files=files, ocr=ocr)


def drain(queue: InMemoryQueue, pipeline: Pipeline) -> None:
    handlers = pipeline.handlers()
    for name in ("book_process", "ocr_page"):
        queue.consume(name, handlers[name], threading.Event())


def test_scanned_pages_are_read_and_the_book_is_built_from_every_page() -> None:
    data = build(
        Spec(
            pages=[[TextLine("Replication", 24), *body(30, 1)], [], [], []],
            inked=[2, 4],  # page 3 is blank
        )
    )
    ocr = InMemoryOcr([OCR_TEXT, OCR_TEXT])
    store, _, queue, pipeline = setup(data, ocr)
    queue.enqueue("book_process", {"book_id": 1}, idempotency_key="book-1")
    drain(queue, pipeline)
    book = store.books.rows[1]
    assert book.status == "ready"
    # Two inked pages read; the blank one never sent.
    assert ocr.calls == 2
    text = " ".join(s.text for c in book.chapters for s in c.sessions)
    # The digital page's heading names the chapter; the scanned text is in it.
    assert book.chapters[0].title == "Replication"
    assert "scannedaa" in text
    assert [p.text != "" for p in book.pages] == [True, True, False, True]


def test_a_page_already_read_is_left_alone() -> None:
    data = build(Spec(pages=[body(20, 1), []], inked=[2]))
    ocr = InMemoryOcr([OCR_TEXT])
    store, _, queue, pipeline = setup(data, ocr)
    queue.enqueue("book_process", {"book_id": 1}, idempotency_key="book-1")
    drain(queue, pipeline)
    assert store.books.rows[1].status == "ready"
    queue.enqueue("ocr_page", {"book_id": 1, "page_no": 2}, idempotency_key="again")
    drain(queue, pipeline)
    assert ocr.calls == 1


def test_ocr_failing_is_retried_and_given_up_on_the_last_attempt() -> None:
    data = build(Spec(pages=[body(20, 1), []], inked=[2]))
    ocr = InMemoryOcr([RuntimeError("ocr down"), RuntimeError("ocr down")])
    store, _, queue, pipeline = setup(data, ocr)
    queue.enqueue("book_process", {"book_id": 1}, idempotency_key="book-1")
    queue.consume(
        "book_process", pipeline.handlers()["book_process"], threading.Event()
    )
    handler = pipeline.handlers()["ocr_page"]
    message = OcrPage(book_id=1, page_no=2)
    with pytest.raises(RuntimeError):
        handler(message, Delivery(attempt=1, idempotency_key="ocr-1-2"))
    assert store.books.rows[1].status == "ocr"
    # The last attempt records the page empty: the book finishes without it.
    handler(message, Delivery(attempt=ATTEMPTS, idempotency_key="ocr-1-2"))
    assert store.books.rows[1].status == "ready"


def test_a_render_is_a_png_and_a_blank_page_is_blank() -> None:
    data = build(Spec(pages=[[], []], inked=[2]))
    with open_pdf(data) as pdf:
        blank, inked = render(pdf, 1, MAX_PIXELS), render(pdf, 2, MAX_PIXELS)
    assert blank.png.startswith(b"\x89PNG") and blank.blank
    assert not inked.blank


def test_a_retry_after_the_page_jobs_failed_to_queue_queues_them_again() -> None:
    data = build(Spec(pages=[body(20, 1), []], inked=[2]))
    store, _, queue, pipeline = setup(data, InMemoryOcr([OCR_TEXT]))
    queue.enqueue("book_process", {"book_id": 1}, idempotency_key="book-1")
    queue.consume(
        "book_process", pipeline.handlers()["book_process"], threading.Event()
    )
    assert queue.pending("ocr_page") == 1

    # As if that enqueue had failed: the book waits, and book_process is retried.
    def dropped(message: BaseModel, delivery: Delivery) -> None:
        del message, delivery

    queue.consume("ocr_page", dropped, threading.Event())
    assert store.books.rows[1].status == "ocr"
    pipeline.handlers()["book_process"](
        BookProcess(book_id=1), Delivery(attempt=2, idempotency_key="book-1")
    )
    assert queue.pending("ocr_page") == 1
    drain(queue, pipeline)
    assert store.books.rows[1].status == "ready"


def test_on_the_last_attempt_a_missing_setting_fails_the_book_with_a_reason() -> None:
    data = build(Spec(pages=[body(20, 1), []], inked=[2]))
    store, files, queue, _ = setup(data, InMemoryOcr([]))

    @contextmanager
    def unit() -> Generator[StageServices]:
        yield StageServices(store, web(), TrafilaturaExtractor())

    unconfigured = Pipeline(unit, queue, files=files)  # no OCR_URL
    queue.enqueue("book_process", {"book_id": 1}, idempotency_key="book-1")
    queue.consume(
        "book_process", unconfigured.handlers()["book_process"], threading.Event()
    )
    handler = unconfigured.handlers()["ocr_page"]
    message = OcrPage(book_id=1, page_no=2)
    with pytest.raises(RuntimeError, match="OCR_URL"):
        handler(message, Delivery(attempt=1, idempotency_key="ocr-1-2"))
    handler(message, Delivery(attempt=ATTEMPTS, idempotency_key="ocr-1-2"))
    assert store.books.rows[1].status == "failed"
    assert store.books.rows[1].failure == GAVE_UP


def test_a_page_too_large_to_render_is_unreadable() -> None:
    data = build(Spec(pages=[[TextLine("a")]]))
    with open_pdf(data) as pdf, pytest.raises(UnreadablePdf):
        render(pdf, 1, max_pixels=1000)
