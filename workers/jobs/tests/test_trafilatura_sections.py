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


# Rules from the real-page fixtures (P1-W2-S05), each pinned on a small page.
PAGE_URL = "https://blog.example.test/posts/wal"


def page(*headings: str, tail: str = "") -> bytes:
    prose = " ".join(
        f"Sentence {i} about write-ahead logging and recovery." for i in range(12)
    )
    body = "".join(f"{h}<p>{prose}</p>" for h in headings)
    return (
        f"<html><head><title>{TITLE}</title></head><body><article>"
        f"<h1>{TITLE}</h1><p>{prose}</p>{body}{tail}</article></body></html>"
    ).encode()


def tree(html: bytes) -> list[tuple[str | None, str | None]]:
    return [(s.heading, s.anchor_id) for s in extract_sections(html, "utf-8", TITLE)]


def test_a_heading_wholly_inside_its_permalink_keeps_its_id() -> None:
    html = page('<h2 id="a"><a href="#a">Alpha</a> <a href="#a">¶</a></h2>')
    assert tree(html) == [(None, None), ("Alpha", "a")]


def test_an_absolute_self_permalink_is_not_a_teaser() -> None:
    html = page(f'<h2 id="a"><a href="{PAGE_URL}#a">Alpha</a></h2>')
    assert tree(html) == [(None, None), ("Alpha", "a")]


def test_a_heading_with_an_inline_external_link_is_kept() -> None:
    html = page(
        '<h2 id="a">Using <a href="https://www.postgresql.org/docs/">pg_dump</a></h2>',
        '<h2 id="b">Alpha <a href="https://twitter.com/intent/tweet"></a></h2>',
    )
    assert tree(html) == [(None, None), ("Using pg_dump", "a"), ("Alpha", "b")]


def test_a_heading_that_is_a_link_to_another_page_is_a_teaser() -> None:
    teaser = '<h3><a href="https://blog.example.test/posts/other">Other post</a></h3>'
    html = page(
        '<h2 id="a">Alpha</h2>',
        tail=f"<h2>Related posts</h2>{teaser}<p>Short blurb.</p>",
    )
    assert tree(html) == [(None, None), ("Alpha", "a")]


def test_a_details_summary_is_text_not_a_section() -> None:
    html = page(
        '<h2 id="a">Alpha</h2>',
        tail="<details><summary>Significant Revisions</summary>"
        "<p>15 October: published</p></details>",
    )
    assert tree(html) == [(None, None), ("Alpha", "a")]


def test_an_empty_section_in_the_middle_is_kept() -> None:
    html = page('<h2 id="a">Alpha</h2><h3 id="b">Beta</h3>')
    sections = extract_sections(html, "utf-8", TITLE)
    assert [(s.heading, s.word_count > 0) for s in sections] == [
        (None, True),
        ("Alpha", False),
        ("Beta", True),
    ]
