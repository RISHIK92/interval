"""The book_process stage (§5F, ING-5, P2-W11-S02): a user's uploaded PDF read into
pages, chapters and sessions, or failed with a reason the user sees."""

from interval_jobs import log
from interval_jobs.books.pdf import ProtectedPdf, UnreadablePdf, open_pdf
from interval_jobs.books.structure import Page, structure
from interval_jobs.ports import BookPageText, Files, Store

PROTECTED = "Protected PDFs can't be read."
UNREADABLE = "This PDF couldn't be read."
NO_TEXT = "No text could be found in this PDF."
MISSING = "The file is missing. Delete the book and upload it again."
NOT_ON_PLAN = "Books aren't part of your plan."


def too_many_pages(limit: int) -> str:
    return f"Over {limit:,} pages."


def process_book(store: Store, files: Files, book_id: int) -> None:
    books = store.books
    # LOAD-5: a book already processed (or deleted) is left as it is.
    job = books.for_processing(book_id)
    if job is None:
        return
    data = files.get(job.file_key)
    if data is None:
        books.fail(book_id, MISSING)
        return
    limit = books.max_pages(job.user_id)
    if limit == 0:  # S01 checks the plan at upload; this is a plan changed since
        books.fail(book_id, NOT_ON_PLAN)
        return
    try:
        with open_pdf(data) as pdf:
            if limit is not None and pdf.page_count > limit:
                books.fail(book_id, too_many_pages(limit))
                return
            title = pdf.title()
            marks = pdf.bookmarks()
            pages = list(pdf.pages())
    except ProtectedPdf:
        books.fail(book_id, PROTECTED)  # §5F: never bypasses DRM
        return
    except UnreadablePdf as error:
        # The error's type only: a parser's message can quote the private text.
        log.warn(
            "books: unreadable pdf",
            book_id=book_id,
            error=type(error.__cause__).__name__,
        )
        books.fail(book_id, UNREADABLE)
        return
    texts = [_text(page) for page in pages]
    if any(t.scanned for t in texts):
        # S03 reads the scanned pages, then builds the chapters from every page.
        books.save(book_id, title, texts, [], "ocr")
        return
    chapters = structure(pages, marks, title or job.title)
    if not chapters:
        books.fail(book_id, NO_TEXT)
        return
    books.save(book_id, title, texts, chapters, "ready")


def _text(page: Page) -> BookPageText:
    return BookPageText(
        page_no=page.no,
        text="\n".join(line.text for line in page.lines),
        scanned=not page.lines,
    )
