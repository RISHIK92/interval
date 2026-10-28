"""The ocr_page stage (ADR-0022, ING-5, P2-W11-S03): one scanned page read by the
Tesseract service; after the book's last one, its chapters and sessions are built from
the digital pages' lines and the scanned pages' text together."""

from collections import Counter
from collections.abc import Callable
from contextlib import AbstractContextManager

from interval_jobs import log
from interval_jobs.books.pdf import ProtectedPdf, UnreadablePdf, open_pdf, render
from interval_jobs.books.process import MISSING, NO_TEXT, PROTECTED, UNREADABLE
from interval_jobs.books.structure import Line, Page, structure
from interval_jobs.ports import Files, Ocr, Store

DEFAULT_SIZE = 10.0  # an all-scanned book has no font sizes: one size, no headings


GAVE_UP = "Scanned pages couldn't be read. Delete the book and upload it again."
MAX_PIXELS = 30_000_000  # a page rendered bigger than this is refused (memory)


def read_page(
    stores: Callable[[], AbstractContextManager[Store]],
    files: Files,
    ocr: Ocr,
    book_id: int,
    page_no: int,
    last_attempt: bool,
) -> None:
    """One scanned page. The database is only held for the reads and writes, not
    through the file, the render and the OCR call."""
    # LOAD-5: a page already read, or a book no longer waiting, is left alone.
    with stores() as store:
        job = store.books.for_ocr(book_id, page_no)
    if job is None:
        return
    data = files.get(job.file_key)
    if data is None:
        give_up(stores, book_id, MISSING)
        return
    try:
        text = _ocr(data, book_id, page_no, ocr)
    except (ProtectedPdf, UnreadablePdf):
        give_up(stores, book_id, UNREADABLE)
        return
    except Exception as error:
        if not last_attempt:
            raise  # the queue tries again
        # The book still finishes, without this page: logged and counted.
        log.error(
            "books: ocr gave up",
            book_id=book_id,
            page_no=page_no,
            error=type(error).__name__,
        )
        text = ""
    with stores() as store:
        if store.books.record_ocr(book_id, page_no, text) == 0:
            _build(store, data, book_id, job.title)


def give_up(
    stores: Callable[[], AbstractContextManager[Store]], book_id: int, reason: str
) -> None:
    with stores() as store:
        store.books.fail(book_id, reason)


def _ocr(data: bytes, book_id: int, page_no: int, ocr: Ocr) -> str:
    with open_pdf(data) as pdf:
        page = render(pdf, page_no, MAX_PIXELS)
    if page.blank:
        # Counted, so a faint scan read as blank shows up (ids only: the text is
        # private).
        log.info("books: blank page skipped", book_id=book_id, page_no=page_no)
        return ""
    return ocr.read(page.png).strip()


def _build(store: Store, data: bytes, book_id: int, title: str) -> None:
    """The book from every page: digital ones as read (with their font sizes), scanned
    ones as their OCR text at the body size."""
    books = store.books
    texts = {p.page_no: p for p in books.pages(book_id)}
    try:
        with open_pdf(data) as pdf:
            pdf_title = pdf.title()
            marks = pdf.bookmarks()
            pages = list(pdf.pages())
    except ProtectedPdf:
        books.fail(book_id, PROTECTED)
        return
    except UnreadablePdf:
        books.fail(book_id, UNREADABLE)
        return
    sizes: Counter[float] = Counter(
        round(line.size, 1) for page in pages for line in page.lines
    )
    body = sizes.most_common(1)[0][0] if sizes else DEFAULT_SIZE
    merged = [
        _scanned(page.no, texts[page.no].text, body)
        if page.no in texts and texts[page.no].scanned
        else page
        for page in pages
    ]
    chapters = structure(merged, marks, pdf_title or title)
    if not chapters:
        books.fail(book_id, NO_TEXT)
        return
    books.save(book_id, pdf_title, list(texts.values()), chapters, "ready")


def _scanned(page_no: int, text: str, size: float) -> Page:
    """OCR text as lines at the body size; Tesseract's blank lines end paragraphs."""
    lines: list[Line] = []
    top = 0.0
    for raw in text.splitlines():
        if not raw.strip():
            top += size * 2.4
            continue
        lines.append(Line(text=raw.strip(), size=size, top=top))
        top += size * 1.2
    return Page(no=page_no, lines=lines)
