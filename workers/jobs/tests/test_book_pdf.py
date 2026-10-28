"""Reading a user's PDF (ING-5, §5F, P2-W11-S02), on PDFs written by hand."""

import pytest
from pdfplumber.pdf import PDF

from interval_jobs.books.pdf import ProtectedPdf, UnreadablePdf, open_pdf

from .pdf_builder import Spec, TextLine, build


def test_pages_lines_sizes_and_the_title_are_read() -> None:
    data = build(
        Spec(
            pages=[
                [TextLine("Replication", 24), TextLine("Copies of the data.", 10)],
                [TextLine("Leaders", 16), TextLine("One node takes writes.", 10)],
            ],
            title="Designing Data Systems",
        )
    )
    with open_pdf(data) as pdf:
        assert pdf.page_count == 2
        assert pdf.title() == "Designing Data Systems"
        pages = list(pdf.pages())
    assert [p.no for p in pages] == [1, 2]
    first = pages[0].lines
    assert [line.text for line in first] == ["Replication", "Copies of the data."]
    assert first[0].size == pytest.approx(24, abs=0.5)
    assert first[1].size == pytest.approx(10, abs=0.5)
    assert first[0].top < first[1].top


def test_the_outline_gives_bookmarks_with_their_pages() -> None:
    data = build(
        Spec(
            pages=[[TextLine("a")], [TextLine("b")], [TextLine("c")]],
            outline=[("Part one", 1), ("Part two", 3)],
        )
    )
    with open_pdf(data) as pdf:
        marks = pdf.bookmarks()
    assert [(m.title, m.page_no) for m in marks] == [("Part one", 1), ("Part two", 3)]


def test_no_outline_no_bookmarks_and_no_title() -> None:
    with open_pdf(build(Spec(pages=[[TextLine("a")]]))) as pdf:
        assert pdf.bookmarks() == []
        assert pdf.title() is None


def test_a_page_without_text_has_no_lines() -> None:
    with open_pdf(build(Spec(pages=[[TextLine("a")], []]))) as pdf:
        assert [len(p.lines) for p in pdf.pages()] == [1, 0]


def test_a_protected_pdf_is_refused() -> None:
    data = build(Spec(pages=[[TextLine("secret")]], encrypted=True))
    with pytest.raises(ProtectedPdf), open_pdf(data):
        pass


def test_bytes_that_are_not_a_pdf_are_unreadable() -> None:
    with pytest.raises(UnreadablePdf), open_pdf(b"%PDF-1.4\nnot really"):
        pass


def test_a_page_tree_that_breaks_when_read_is_unreadable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # pdfplumber reads the page tree lazily; when that fails, the book fails at open
    # (with a reason) rather than later, where the job would be retried for ever.
    def broken(self: object) -> list[object]:
        raise ValueError("bad page tree")

    monkeypatch.setattr(PDF, "pages", property(broken))
    with pytest.raises(UnreadablePdf), open_pdf(build(Spec(pages=[[TextLine("a")]]))):
        pass


def test_a_page_tree_with_no_pages_opens_with_none() -> None:
    data = build(Spec(pages=[[TextLine("a")]])).replace(
        b"/Type /Page ", b"/Type /Pagz ", 1
    )
    with open_pdf(data) as pdf:
        assert pdf.page_count == 0
