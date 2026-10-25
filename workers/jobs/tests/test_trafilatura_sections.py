from interval_jobs.adapters.trafilatura_extractor import extract_sections
from interval_jobs.ports import Section

from .conftest import fixture_bytes

TITLE = "How our write-ahead log works"


def sections(name: str, title: str = TITLE) -> list[Section]:
    return extract_sections(fixture_bytes(name), "utf-8", title)


def test_headings_keep_level_and_publisher_ids_in_order() -> None:
    got = [
        (s.heading, s.level, s.anchor_id) for s in sections("article.html") if s.heading
    ]
    assert got == [
        ("Why a log", 2, "why"),
        ("Recovery", 2, "recovery"),
    ]


def test_child_anchor_names_and_repeated_headings_map_in_document_order() -> None:
    ids = {
        (s.heading, s.anchor_id) for s in sections("article_mixed.html") if s.heading
    }
    assert ("Setup", "setup") in ids
    assert ("Log shipping", "log-shipping") in ids
    assert ("Plain heading", None) in ids
    notes = [
        s.anchor_id for s in sections("article_mixed.html") if s.heading == "Notes"
    ]
    assert notes == ["notes-1", "notes-2"]


def test_text_under_a_leading_h1_title_is_the_intro_section() -> None:
    first = sections("article_no_ids.html")[0]
    assert first.heading is None
    assert first.level is None
    assert first.word_count == 3 * 17


def test_word_counts_cover_prose_and_code_but_not_navigation() -> None:
    by_heading = {s.heading: s.word_count for s in sections("article_mixed.html")}
    # 4 paragraphs of 17 words, plus 60 code lines of 3 tokens each.
    assert by_heading["Log shipping"] == 4 * 17 + 60 * 3


def test_page_without_headings_has_only_an_intro() -> None:
    got = sections("article_no_headings.html")
    assert len(got) == 1
    assert got[0].heading is None
    assert got[0].word_count > 0


def test_headings_outside_the_article_do_not_steal_ids() -> None:
    ids = {s.heading: s.anchor_id for s in sections("article_edge.html") if s.heading}
    assert ids["Notes"] == "notes"


def test_permalink_glyphs_and_zero_width_marks_are_removed() -> None:
    ids = {s.heading: s.anchor_id for s in sections("article_edge.html") if s.heading}
    assert ids["Setup"] == "setup"
    assert ids["Docusaurus style"] == "docu"


def test_child_anchor_beats_the_section_id() -> None:
    ids = {s.heading: s.anchor_id for s in sections("article_edge.html") if s.heading}
    assert ids["Gamma"] == "child"


def test_unclosed_heading_still_keeps_its_id() -> None:
    page = (
        b"<html><body><article><h2 id='a'>Alpha<p>" + b"word " * 60 + b"</p></article>"
    )
    got = extract_sections(page, "utf-8", "x")
    assert [(s.heading, s.anchor_id) for s in got if s.heading] == [("Alpha", "a")]


def test_leading_h1_is_a_section_when_it_is_not_the_title() -> None:
    got = sections("article_all_h1.html", "Replication basics")
    assert [(s.heading, s.anchor_id) for s in got] == [("One", "one"), ("Two", "two")]


def test_long_headings_are_capped() -> None:
    page = (
        b"<html><body><article><h2>" + b"x " * 400 + b"</h2><p>" + b"w " * 50 + b"</p>"
    )
    (section,) = extract_sections(page + b"</article>", "utf-8", "t")
    assert section.heading is not None
    assert len(section.heading) <= 300
