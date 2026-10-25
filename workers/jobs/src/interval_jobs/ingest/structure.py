"""Heading structure of an article: sections with heading, level, publisher id, words.

trafilatura finds the main content and keeps headings, but drops their `id`s; a second
pass over the original page (stdlib html.parser) maps each heading to its id (proposal
section 3, option 1). Only headings and counts leave this module, never body text.
"""

import re
import unicodedata
import xml.etree.ElementTree as ElementTree
from dataclasses import dataclass, field
from html.parser import HTMLParser

import trafilatura
from trafilatura.utils import decode_file

_HEADING_TAGS = frozenset({"h1", "h2", "h3", "h4", "h5", "h6"})
# trafilatura drops these regions, so their headings must not take part in id matching.
_SKIPPED_REGIONS = frozenset({"nav", "aside", "header", "footer"})
# A block start inside an open heading means the heading was never closed.
_BLOCK_TAGS = frozenset({"p", "div", "section", "article", "ul", "ol", "pre", "table"})
# Permalink glyphs that publishing tools append to headings (Sphinx, MkDocs, Hugo).
_PERMALINK_GLYPHS = "¶#§🔗"
HEADING_MAX_CHARS = 300


@dataclass(frozen=True)
class Section:
    heading: str | None  # None for the intro
    level: int | None
    anchor_id: str | None
    word_count: int


def _strip_format_chars(text: str) -> str:
    # Zero-width spaces and similar (Unicode category Cf) differ between parsers.
    return "".join(ch for ch in text if unicodedata.category(ch) != "Cf")


def _norm(text: str) -> str:
    return " ".join(_strip_format_chars(text).split()).casefold()


def clean_heading(text: str) -> str:
    cleaned = (
        " ".join(_strip_format_chars(text).split()).rstrip(_PERMALINK_GLYPHS).strip()
    )
    return cleaned[:HEADING_MAX_CHARS]


def _words(text: str) -> int:
    return len(text.split())


@dataclass
class _OpenHeading:
    anchor: str | None
    text: list[str] = field(default_factory=list[str])
    in_permalink: bool = False


class _HeadingIds(HTMLParser):
    """Collects (normalised heading text, id) in document order.

    The id is the heading's own `id`, else an `id`/`name` on an anchor inside it, else
    the `id` of the `<section>` it opens. Headings inside nav/aside/header/footer are
    skipped, and permalink anchors (`<a href="#...">`) do not count as heading text.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.found: list[tuple[str, str | None]] = []
        self._sections: list[str | None] = []
        self._section_fresh = False
        self._skip_depth = 0
        self._open: _OpenHeading | None = None
        self._section_id: str | None = None

    def _close_heading(self) -> None:
        if self._open is None:
            return
        anchor = self._open.anchor or self._section_id
        self.found.append((_norm("".join(self._open.text)), anchor or None))
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
            self._open.in_permalink = (values.get("href") or "").startswith("#")
            return
        if tag not in ("span", "code", "em", "strong", "b", "i"):
            self._section_fresh = False

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIPPED_REGIONS and self._skip_depth:
            self._skip_depth -= 1
        elif tag == "section" and self._sections:
            self._sections.pop()
        elif tag == "a" and self._open is not None:
            self._open.in_permalink = False
        elif tag in _HEADING_TAGS:
            self._close_heading()

    def handle_data(self, data: str) -> None:
        if self._open is not None and not self._open.in_permalink:
            self._open.text.append(data)

    def close(self) -> None:
        super().close()
        self._close_heading()


def _publisher_ids(document: str) -> list[tuple[str, str | None]]:
    parser = _HeadingIds()
    parser.feed(document)
    parser.close()
    return parser.found


class _IdMatcher:
    """Matches extracted headings to publisher headings, moving forward only."""

    def __init__(self, candidates: list[tuple[str, str | None]]) -> None:
        self._candidates = candidates
        self._next = 0

    def take(self, heading: str) -> str | None:
        key = _norm(heading)
        for index in range(self._next, len(self._candidates)):
            text, anchor = self._candidates[index]
            if text == key:
                self._next = index + 1
                return anchor
        return None


def extract_sections(page: bytes, encoding: str | None, title: str) -> list[Section]:
    # The declared charset, else trafilatura's detection (same as extract.py).
    document = (
        page.decode(encoding, errors="replace") if encoding else decode_file(page)
    )
    xml = trafilatura.extract(
        document, output_format="xml", include_comments=False, include_tables=False
    )
    if not xml:
        return []
    main = ElementTree.fromstring(xml).find("main")
    if main is None:
        return []

    ids = _IdMatcher(_publisher_ids(document))
    sections: list[Section] = []
    heading: str | None = None
    level: int | None = None
    anchor: str | None = None
    words = 0
    for position, block in enumerate(main):
        if block.tag == "head":
            text = clean_heading("".join(block.itertext()))
            # A leading h1 that repeats the item title is the page title: the text
            # under it is the intro (owner, 2026-10-25).
            is_title = block.get("rend") == "h1" and _norm(text) == _norm(title)
            if position == 0 and is_title:
                ids.take(text)
                continue
            if heading is not None or words:
                sections.append(Section(heading, level, anchor, words))
            heading = text
            match = re.fullmatch(r"h([1-6])", block.get("rend") or "")
            level = int(match.group(1)) if match else None
            anchor = ids.take(text)
            words = 0
        else:
            words += _words("".join(block.itertext()))
    if heading is not None or words:
        sections.append(Section(heading, level, anchor, words))
    return sections
