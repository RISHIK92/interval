"""Extractor adapter (ADR-0012): main text and heading structure via trafilatura.

Heading structure: sections with heading, level, publisher id, words. Checked against
pages from six seed sources (tests/test_real_pages.py, P1-W2-S05), which settled the
library: trafilatura's default mode plus the rules below. Its precision mode drops every
heading that is wholly a link, a common permalink style.

Rules on top of trafilatura, from those pages:
- a heading whose whole text is a link to another page is a teaser card (related
  posts), so it and its text are dropped; a link with a fragment is a permalink;
- trafilatura heads that aren't h1-h6 (a `<details>` summary) are text, not sections;
- empty headings at the end (tag lists, "Written by") are dropped. A last section that
  holds only a table is dropped with them (tables aren't counted); the pages showed
  debris there far more often than table-only endings.

trafilatura finds the main content and keeps headings, but drops their `id`s; a second
pass over the original page (stdlib html.parser) maps each heading to its id (proposal
section 3, option 1). Only headings and counts leave this module, never body text.
"""

import re
import xml.etree.ElementTree as ElementTree
from dataclasses import dataclass, field
from html.parser import HTMLParser

import trafilatura
from trafilatura.utils import decode_file

from interval_jobs.headings import clean_heading
from interval_jobs.headings import heading_key as _norm
from interval_jobs.ports import ExtractionError, Section

_HEADING_TAGS = frozenset({"h1", "h2", "h3", "h4", "h5", "h6"})
# trafilatura drops these regions, so their headings must not take part in id matching.
_SKIPPED_REGIONS = frozenset({"nav", "aside", "header", "footer"})
# A block start inside an open heading means the heading was never closed.
_BLOCK_TAGS = frozenset({"p", "div", "section", "article", "ul", "ol", "pre", "table"})


def _words(text: str) -> int:
    return len(text.split())


@dataclass
class _OpenHeading:
    anchor: str | None
    text: list[str] = field(default_factory=list[str])
    link_text: list[str] = field(default_factory=list[str])  # inside permalinks
    out_text: list[str] = field(default_factory=list[str])  # inside off-page links
    link: str | None = None  # "permalink" or "out" while inside an <a>


@dataclass(frozen=True)
class _PublisherHeading:
    text: str  # normalised
    anchor: str | None
    teaser: bool  # its whole text links to another page


def _is_teaser(heading: _OpenHeading) -> bool:
    out = _norm(clean_heading("".join(heading.out_text)))
    return bool(out) and out == _norm(clean_heading("".join(heading.text)))


class _HeadingIds(HTMLParser):
    """Collects the page's headings in document order.

    The id is the heading's own `id`, else an `id`/`name` on an anchor inside it, else
    the `id` of the `<section>` it opens. Headings inside nav/aside/header/footer are
    skipped. Permalink anchors (`<a href="#...">`) are not heading text, unless they
    hold all of it (`<h2 id=x><a href="#x">Title</a></h2>`).
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.found: list[_PublisherHeading] = []
        self._sections: list[str | None] = []
        self._section_fresh = False
        self._skip_depth = 0
        self._open: _OpenHeading | None = None
        self._section_id: str | None = None

    def _close_heading(self) -> None:
        if self._open is None:
            return
        anchor = self._open.anchor or self._section_id
        text = "".join(self._open.text)
        if not clean_heading(text):
            text = clean_heading("".join(self._open.link_text))
        self.found.append(
            _PublisherHeading(_norm(text), anchor or None, _is_teaser(self._open))
        )
        self._open = None
        self._section_fresh = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag in _SKIPPED_REGIONS:
            self._skip_depth += 1
            return
        if tag in _BLOCK_TAGS or tag in _HEADING_TAGS:
            self._close_heading()
        if tag == "section":
            self._sections.append(values.get("id"))
            self._section_fresh = True
            return
        if tag in _HEADING_TAGS:
            if self._skip_depth:
                return
            fresh = self._section_fresh and self._sections
            self._section_id = self._sections[-1] if fresh else None
            self._open = _OpenHeading(anchor=values.get("id"))
            return
        if tag == "a" and self._open is not None:
            if self._open.anchor is None:
                self._open.anchor = values.get("id") or values.get("name")
            href = values.get("href") or ""
            if "#" in href:
                self._open.link = "permalink"
            elif href:
                self._open.link = "out"
            return
        if tag not in ("span", "code", "em", "strong", "b", "i"):
            self._section_fresh = False

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIPPED_REGIONS and self._skip_depth:
            self._skip_depth -= 1
        elif tag == "section" and self._sections:
            self._sections.pop()
        elif tag == "a" and self._open is not None:
            self._open.link = None
        elif tag in _HEADING_TAGS:
            self._close_heading()

    def handle_data(self, data: str) -> None:
        if self._open is None:
            return
        if self._open.link == "permalink":
            self._open.link_text.append(data)
            return
        self._open.text.append(data)
        if self._open.link == "out":
            self._open.out_text.append(data)

    def close(self) -> None:
        super().close()
        self._close_heading()


def _publisher_headings(document: str) -> list[_PublisherHeading]:
    parser = _HeadingIds()
    parser.feed(document)
    parser.close()
    return parser.found


class _IdMatcher:
    """Matches extracted headings to publisher headings, moving forward only."""

    def __init__(self, candidates: list[_PublisherHeading]) -> None:
        self._candidates = candidates
        self._next = 0

    def take(self, heading: str) -> _PublisherHeading | None:
        key = _norm(heading)
        for index in range(self._next, len(self._candidates)):
            if self._candidates[index].text == key:
                self._next = index + 1
                return self._candidates[index]
        return None


def _decode(page: bytes, encoding: str | None) -> str:
    # The declared charset, else trafilatura's detection.
    return page.decode(encoding, errors="replace") if encoding else decode_file(page)


def extract_sections(page: bytes, encoding: str | None, title: str) -> list[Section]:
    document = _decode(page, encoding)
    xml = trafilatura.extract(
        document, output_format="xml", include_comments=False, include_tables=False
    )
    if not xml:
        return []
    main = ElementTree.fromstring(xml).find("main")
    if main is None:
        return []

    publisher = _IdMatcher(_publisher_headings(document))
    sections: list[Section] = []
    heading: str | None = None
    level: int | None = None
    anchor: str | None = None
    words = 0
    in_teaser = False  # a teaser card's text isn't the article's
    for position, block in enumerate(main):
        match = re.fullmatch(r"h([1-6])", block.get("rend") or "")
        if block.tag != "head" or match is None:
            if not in_teaser:
                words += _words("".join(block.itertext()))
            continue
        text = clean_heading("".join(block.itertext()))
        # A leading h1 that repeats the item title is the page title: the text
        # under it is the intro (owner, 2026-10-25).
        is_title = match.group(1) == "1" and _norm(text) == _norm(title)
        if position == 0 and is_title:
            publisher.take(text)
            continue
        found = publisher.take(text)
        in_teaser = found is not None and found.teaser
        if in_teaser:
            continue
        if heading is not None or words:
            sections.append(Section(heading, level, anchor, words))
        heading, level = text, int(match.group(1))
        anchor = found.anchor if found is not None else None
        words = 0
    if heading is not None or words:
        sections.append(Section(heading, level, anchor, words))
    while sections and sections[-1].heading is not None and not sections[-1].word_count:
        sections.pop()
    return sections


def extract_text(page: bytes, encoding: str | None) -> str:
    text = trafilatura.extract(
        _decode(page, encoding), include_comments=False, include_tables=False
    )
    if not text or not text.strip():
        raise ExtractionError("no main text found in page")
    return text.strip()


class TrafilaturaExtractor:
    def text(self, html: bytes, encoding: str | None) -> str:
        return extract_text(html, encoding)

    def sections(self, html: bytes, encoding: str | None, title: str) -> list[Section]:
        return extract_sections(html, encoding, title)
