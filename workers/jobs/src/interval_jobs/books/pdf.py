"""Reading a user's PDF with pdfplumber (ING-5, Q-P2-37, P2-W11-S02): its page count,
title, top-level bookmarks, and each page's text lines with their font sizes, one page
at a time. A protected (encrypted) PDF is refused: Interval never bypasses DRM (§5F)."""

import io
from collections.abc import Generator, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import cast

import pdfplumber
from pdfminer.pdfdocument import PDFDocument, PDFEncryptionError, PDFPasswordIncorrect
from pdfminer.pdftypes import resolve1
from pdfplumber.page import Page as PdfPage
from pdfplumber.pdf import PDF

from interval_jobs import log
from interval_jobs.books.structure import Bookmark, Line, Page


class ProtectedPdf(Exception):
    pass


class UnreadablePdf(Exception):
    pass


class OpenPdf:
    """A parsed PDF. Its page tree and title are read when it opens (open_pdf), so a
    broken file is refused there, before anything is saved."""

    def __init__(self, pdf: PDF) -> None:
        self._pdf = pdf
        self._pages = list(pdf.pages)
        self._title = _title(pdf)

    @property
    def page_count(self) -> int:
        return len(self._pages)

    def title(self) -> str | None:
        return self._title

    def bookmarks(self) -> list[Bookmark]:
        """The outline's top level, each with the page it points to; entries that
        don't resolve to a page are left out, and a broken outline gives none (the
        chapters then come from headings)."""
        doc = self._pdf.doc
        page_of = {
            cast(int, page.page_obj.pageid): n for n, page in enumerate(self._pages, 1)
        }
        marks: list[Bookmark] = []
        try:
            outlines = list(doc.get_outlines())
            top = min((level for level, *_ in outlines), default=1)
            for level, title, dest, action, _ in outlines:
                if level != top or not isinstance(title, str):
                    continue
                page_no = _page(doc, dest, action, page_of)
                if page_no is not None:
                    marks.append(
                        Bookmark(title=" ".join(title.split()), page_no=page_no)
                    )
        except Exception:  # no outline, or a broken one: chapters from headings
            return []
        return marks

    def page(self, page_no: int) -> PdfPage:
        return self._pages[page_no - 1]

    def pages(self) -> Iterator[Page]:
        for n, page in enumerate(self._pages, 1):
            try:
                rows = page.extract_text_lines(return_chars=True)
            except Exception as error:
                # A broken page breaks the book: it fails with a reason, not forever.
                raise UnreadablePdf(f"page {n}") from error
            lines = [
                Line(
                    text=row["text"],
                    size=sum(c["size"] for c in row["chars"]) / len(row["chars"]),
                    top=float(row["top"]),
                )
                for row in rows
                if row["chars"] and row["text"].strip()
            ]
            yield Page(no=n, lines=lines)
            page.close()  # frees the page's parsed objects: one page at a time


RENDER_DPI = 200  # enough for Tesseract on book text; a page is a few MB as a PNG
MIN_DPI = 72  # a page that would need less to fit the pixel limit is refused
# A page whose share of inked pixels (anything darker than light gray, so a faint scan
# still counts) is under this is blank: a cover's back, a verso.
BLANK_INK = 0.0005
INK = 200


@dataclass(frozen=True)
class Rendered:
    png: bytes
    blank: bool


def render(pdf: OpenPdf, page_no: int, max_pixels: int) -> Rendered:
    """One page as an image, for OCR (ADR-0022, P2-W11-S03). The PDF is the user's: a
    page's size can be anything, so the resolution drops to keep the image within
    `max_pixels`, and a page that would still be too big is refused."""
    page = pdf.page(page_no)
    try:
        inches = (float(page.width) / 72) * (float(page.height) / 72)
        dpi = min(RENDER_DPI, int((max_pixels / max(inches, 1e-6)) ** 0.5))
        if dpi < MIN_DPI:
            raise UnreadablePdf(f"page {page_no} is too large")
        image = page.to_image(resolution=dpi).original
    except UnreadablePdf:
        raise
    except Exception as error:
        raise UnreadablePdf(f"page {page_no}") from error
    gray = image.convert("L")
    histogram = gray.histogram()
    dark = sum(histogram[:INK])
    blank = dark < BLANK_INK * gray.width * gray.height
    out = io.BytesIO()
    gray.save(out, format="PNG")
    return Rendered(png=out.getvalue(), blank=blank)


def _title(pdf: PDF) -> str | None:
    # pdfplumber types the document info as an untyped dict.
    metadata = cast(
        dict[str, object],
        pdf.metadata,  # pyright: ignore[reportUnknownMemberType]
    )
    value: object = resolve1(metadata.get("Title"))
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    text = " ".join(value.split()) if isinstance(value, str) else ""
    return text or None


def _page(
    doc: PDFDocument, dest: object, action: object, page_of: dict[int, int]
) -> int | None:
    if dest is None and action is not None:
        resolved: object = resolve1(action)
        if isinstance(resolved, dict):
            dest = cast(dict[str, object], resolved).get("D")
    dest = resolve1(dest)
    if isinstance(dest, (str, bytes)):
        try:
            dest = resolve1(doc.get_dest(dest))
        except Exception:  # a named destination that isn't there
            return None
    if isinstance(dest, dict):
        dest = resolve1(cast(dict[str, object], dest).get("D"))
    if isinstance(dest, list) and dest:
        ref: object = cast(list[object], dest)[0]
        objid: object = getattr(ref, "objid", None)
        return page_of.get(objid) if isinstance(objid, int) else None
    return None


@contextmanager
def open_pdf(data: bytes) -> Generator[OpenPdf]:
    try:
        pdf = pdfplumber.open(io.BytesIO(data))
    except Exception as error:
        # pdfplumber wraps pdfminer's errors; a password or encryption error anywhere
        # in the chain means the file is protected.
        cause: BaseException | None = error
        while cause is not None:
            if isinstance(cause, (PDFPasswordIncorrect, PDFEncryptionError)):
                raise ProtectedPdf from error
            cause = cause.__cause__ or cause.__context__
        raise UnreadablePdf from error
    try:
        # Opens without a password (an owner password only) but is still protected.
        if pdf.doc.encryption is not None:
            raise ProtectedPdf
        try:
            opened = OpenPdf(pdf)
        except Exception as error:
            # pdfplumber reads the page tree lazily: a broken one fails here, and the
            # book fails with a reason instead of being retried for ever.
            raise UnreadablePdf from error
        yield opened
    finally:
        try:
            pdf.close()
        except Exception as error:
            # Closing a broken file can fail the same way it did: logged, so the
            # reason it was refused is the error that propagates.
            log.warn("books: pdf close failed", error=type(error).__name__)
