"""A book's chapters and sessions from its pages' lines (§5F, ING-4, ING-5, P2-W11-S02).

Chapters come from the PDF's bookmarks, else its largest headings, else the whole book
is one. Each chapter is split at its headings into 2 to 8 minute sessions by the same
rules as moments (segment.plan_units); a stretch with no headings is cut at paragraph
breaks. Headings are found by font size: a short line clearly larger than the body.
"""

import re
from collections import Counter
from dataclasses import dataclass, replace

from interval_jobs.ports import BookChapterRow, BookSessionRow, SectionRow
from interval_jobs.segment import MAX_WORDS, MIN_WORDS, minutes, plan_units

HEADING_RATIO = 1.15
HEADING_MAX_CHARS = 120
SIZE_TOLERANCE = 0.5  # points: sizes this close are one heading level
PARAGRAPH_GAP = 1.5  # a gap this many line heights starts a paragraph
RUNNING_SHARE = 0.25  # a line on this share of pages is a running header or footer
RUNNING_EDGE = 2  # running headers and footers are among a page's first and last lines
TARGET_WORDS = 5 * 230  # a heading-less stretch is cut near 5 minutes
TITLE_MAX = 300


@dataclass(frozen=True)
class Line:
    text: str
    size: float  # mean font size, points
    top: float  # distance from the page's top, points


@dataclass(frozen=True)
class Page:
    no: int  # 1-based
    lines: list[Line]


@dataclass(frozen=True)
class Bookmark:
    title: str
    page_no: int


@dataclass
class _Para:
    page_no: int
    lines: list[str]
    heading_level: int | None  # a heading is a paragraph of its own
    pages: list[int]  # each line's page: a paragraph can run across a page break

    @property
    def last_page(self) -> int:
        return self.pages[-1] if self.pages else self.page_no

    def text(self) -> str:
        out = ""
        for line in self.lines:
            # A word broken across lines ("exam-" / "ple") is joined back.
            if out.endswith("-") and line[:1].islower():
                out = out[:-1] + line
            else:
                out = f"{out} {line}" if out else line
        return out

    def words(self) -> int:
        return len(self.text().split())


def _key(text: str) -> str:
    return re.sub(r"\d+", "#", " ".join(text.lower().split()))


def _edges(page: Page) -> list[Line]:
    """A page's first and last lines, top to bottom."""
    ordered = sorted(page.lines, key=lambda line: line.top)
    if len(ordered) <= 2 * RUNNING_EDGE:
        return ordered
    return ordered[:RUNNING_EDGE] + ordered[-RUNNING_EDGE:]


def _running(pages: list[Page]) -> set[tuple[int, float, str]]:
    """Running headers and footers: a page's first or last lines that repeat, digits
    aside, on many pages. Only at the edges, so a line repeated in the body (a code
    listing's closing brace) stays. Keyed by page, position and text."""
    if len(pages) < 4:
        return set()
    seen: Counter[str] = Counter()
    for page in pages:
        seen.update({_key(line.text) for line in _edges(page)})
    floor = max(3, RUNNING_SHARE * len(pages))
    repeated = {key for key, count in seen.items() if count >= floor}
    return {
        (page.no, line.top, line.text)
        for page in pages
        for line in _edges(page)
        if _key(line.text) in repeated
    }


def _body_size(pages: list[Page]) -> float:
    sizes: Counter[float] = Counter()
    for page in pages:
        for line in page.lines:
            sizes[round(line.size, 1)] += len(line.text)
    return sizes.most_common(1)[0][0] if sizes else 0.0


def _is_heading(line: Line, body: float) -> bool:
    text = line.text.strip()
    return (
        body > 0
        and line.size >= body * HEADING_RATIO
        and 2 <= len(text) <= HEADING_MAX_CHARS
        and any(c.isalpha() for c in text)
    )


def _levels(sizes: list[float]) -> dict[float, int]:
    """Distinct heading sizes, largest first, as levels 1, 2, ..."""
    levels: dict[float, int] = {}
    tops: list[float] = []
    for size in sorted(set(sizes), reverse=True):
        if not tops or tops[-1] - size > SIZE_TOLERANCE:
            tops.append(size)
        levels[size] = len(tops)
    return levels


def _paragraphs(pages: list[Page]) -> list[_Para]:
    running = _running(pages)
    body = _body_size(pages)
    kept = [
        (page.no, line)
        for page in pages
        for line in page.lines
        if line.text.strip() and (page.no, line.top, line.text) not in running
    ]
    heading_sizes = [line.size for _, line in kept if _is_heading(line, body)]
    # A size only one heading uses, beside headings of other sizes, is a title page or
    # a one-off: not a level, or it would swallow the real chapters.
    uses = Counter(round(size, 1) for size in heading_sizes)
    levels = _levels(
        [size for size in heading_sizes if uses[round(size, 1)] > 1 or len(uses) == 1]
    )
    paras: list[_Para] = []
    previous: tuple[int, Line] | None = None
    for page_no, line in kept:
        level = levels.get(line.size) if _is_heading(line, body) else None
        text = line.text.strip()
        current = paras[-1] if paras else None
        close = previous is not None and (
            line.top - previous[1].top <= PARAGRAPH_GAP * previous[1].size * 1.2
        )
        joins = current is not None and (
            # Body text runs on, across pages too.
            (
                level is None
                and current.heading_level is None
                and previous is not None
                and (page_no != previous[0] or close)
            )
            # A heading wrapped onto a second line is still one heading.
            or (
                level is not None
                and current.heading_level == level
                and previous is not None
                and page_no == previous[0]
                and close
            )
        )
        if joins and current is not None:
            current.lines.append(text)
            current.pages.append(page_no)
        else:
            paras.append(_Para(page_no, [text], level, [page_no]))
        previous = (page_no, line)
    return paras


def _title(text: str) -> str:
    return " ".join(text.split())[:TITLE_MAX]


def _split_long(para: _Para) -> list[_Para]:
    """A paragraph longer than a session (a book that marks paragraphs by indent,
    not space, reads as one) is split at line breaks near 5 minutes."""
    if para.words() <= MAX_WORDS:
        return [para]
    parts: list[_Para] = []
    for line, page in zip(para.lines, para.pages, strict=True):
        current = parts[-1] if parts else None
        if current is None or current.words() >= TARGET_WORDS:
            parts.append(_Para(page, [line], para.heading_level, [page]))
        else:
            current.lines.append(line)
            current.pages.append(page)
    return parts


def _cut(paras: list[_Para], title: str) -> list[BookSessionRow]:
    """A stretch with no headings to split at: pieces near 5 minutes, at paragraph
    breaks, never past 8 unless one paragraph is that long by itself."""
    pieces: list[list[_Para]] = []
    for para in (part for p in paras for part in _split_long(p)):
        so_far = sum(p.words() for p in pieces[-1]) if pieces else 0
        if pieces and so_far < TARGET_WORDS and so_far + para.words() <= MAX_WORDS:
            pieces[-1].append(para)
        else:
            pieces.append([para])
    # A short last piece joins the one before when it fits.
    if len(pieces) > 1:
        last = sum(p.words() for p in pieces[-1])
        before = sum(p.words() for p in pieces[-2])
        if last < MIN_WORDS and last + before <= MAX_WORDS:
            pieces[-2:] = [pieces[-2] + pieces[-1]]
    sessions: list[BookSessionRow] = []
    for n, piece in enumerate(pieces, start=1):
        text = "\n\n".join(p.text() for p in piece)
        sessions.append(
            BookSessionRow(
                title=title if len(pieces) == 1 else _title(f"{title}, part {n}"),
                text=text,
                minutes=minutes(len(text.split())),
                first_page=piece[0].page_no,
                last_page=max(p.last_page for p in piece),
            )
        )
    return sessions


def _sessions(
    paras: list[_Para], chapter_title: str, depth: int
) -> list[BookSessionRow]:
    """A chapter's paragraphs as sessions: split at headings deeper than `depth`."""
    groups: list[tuple[_Para | None, list[_Para]]] = [(None, [])]
    for para in paras:
        if para.heading_level is not None and para.heading_level > depth:
            groups.append((para, []))
        else:
            groups[-1][1].append(para)
    if groups[0][0] is None and not groups[0][1]:
        groups = groups[1:]
    rows: list[SectionRow] = []
    for i, (heading, body) in enumerate(groups):
        rows.append(
            SectionRow(
                heading=None if heading is None else _title(heading.text()),
                anchor_id=str(i),
                word_count=sum(p.words() for p in body)
                + (0 if heading is None else heading.words()),
                level=None if heading is None else (heading.heading_level or 1) - depth,
            )
        )
    units = plan_units(rows) if any(r.heading for r in rows) else [rows]
    # A short intro joins the session after it rather than standing alone.
    if (
        len(units) > 1
        and units[0][0].heading is None
        and sum(r.word_count for r in units[0]) < MIN_WORDS
    ):
        units[0:2] = [units[0] + units[1]]
    sessions: list[BookSessionRow] = []
    for unit in units:
        parts = [p for r in unit for p in _group_paras(groups[int(r.anchor_id or 0)])]
        if not any(p.words() for p in parts):
            continue
        named = next((r.heading for r in unit if r.heading), None) or chapter_title
        words = sum(p.words() for p in parts)
        if words > MAX_WORDS:
            sessions.extend(_cut(parts, named))
            continue
        text = "\n\n".join(p.text() for p in parts)
        sessions.append(
            BookSessionRow(
                title=named,
                text=text,
                minutes=minutes(len(text.split())),
                first_page=parts[0].page_no,
                last_page=max(p.last_page for p in parts),
            )
        )
    return sessions


def _group_paras(group: tuple[_Para | None, list[_Para]]) -> list[_Para]:
    heading, body = group
    return body if heading is None else [heading, *body]


def structure(
    pages: list[Page], bookmarks: list[Bookmark], book_title: str
) -> list[BookChapterRow]:
    """Chapters and their sessions; empty when the pages have no text."""
    paras = _paragraphs(pages)
    if not paras:
        return []
    marks = sorted((b for b in bookmarks if b.title.strip()), key=lambda b: b.page_no)
    chapters: list[tuple[str, list[_Para], int]] = []  # title, paragraphs, depth
    if marks:
        # Text before the first bookmark (front matter) opens the first chapter.
        chapters = [(_title(mark.title), [], 0) for mark in marks]
        index = 0
        for para in paras:
            while index + 1 < len(marks) and para.page_no >= marks[index + 1].page_no:
                index += 1
            chapters[index][1].append(para)
    elif any(p.heading_level == 1 for p in paras):
        front: list[_Para] = []
        for para in paras:
            if para.heading_level == 1:
                chapters.append((_title(para.text()), [], 1))
            elif chapters:
                chapters[-1][1].append(para)
            else:
                front.append(para)
        # Text before the first chapter: its own chapter when there's a session's
        # worth (a preface), else it opens the first (a title page).
        if sum(p.words() for p in front) >= MIN_WORDS:
            chapters.insert(0, (_title(book_title), front, 1))
        else:
            chapters[0][1][:0] = front
    else:
        chapters.append((_title(book_title), paras, 0))
    result: list[BookChapterRow] = []
    for title, body, depth in chapters:
        sessions = _sessions(body, title, depth)
        if sessions:
            result.append(BookChapterRow(title=title or "Chapter", sessions=sessions))
    return _cover_every_page(result, max(p.no for p in pages))


def _cover_every_page(
    chapters: list[BookChapterRow], last_page: int
) -> list[BookChapterRow]:
    """Pages with no text (a full-page figure, a blank page) belong to the session
    before them, and the book's last pages to its last session: the reader shows a
    session's PDF pages, so none goes missing."""
    flat = [s for c in chapters for s in c.sessions]
    ends = [nxt.first_page - 1 for nxt in flat[1:]] + [last_page]
    covered = iter(
        replace(s, last_page=max(s.last_page, end))
        for s, end in zip(flat, ends, strict=True)
    )
    return [replace(c, sessions=[next(covered) for _ in c.sessions]) for c in chapters]
