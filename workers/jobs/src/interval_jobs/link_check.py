"""Deep-link verification (§3.2, ING-4, Q-P1-25, P1-W6-S02): does each moment's link
land on its section?

Pages come through the polite fetcher (robots.txt, per-host spacing) and are read as
served, without running scripts (owner, 2026-10-26): a page that builds its headings
in JavaScript fails here, and the reasons show it. What "lands" means, per link type:

- anchor: an element with the fragment's id exists and its text starts with the
  moment's title (the id may be on the heading or on a section wrapping it);
- text_fragment: the fragment's text is in the page's visible text;
- page_top: the moment's title is in the page's visible text.

A page that can't be checked (robots.txt, a timeout, a 5xx, a block) is "unchecked":
reported, but outside the pass rate. A 404 or 410 is a fail (owner, 2026-10-26).
Sources under a 90% pass rate are flagged for the owner, who switches their moments
off (Q-P1-25); nothing is switched or stored here.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from html.parser import HTMLParser
from itertools import groupby
from typing import Literal, Protocol, TypedDict
from urllib.parse import unquote

from interval_jobs import log
from interval_jobs.headings import PERMALINK_GLYPHS, heading_key
from interval_jobs.ports import (
    Fetcher,
    FetchError,
    FetchStatusError,
    MomentLink,
    RobotsDisallowed,
)

PASS_RATE = 0.9  # Q-P1-25 (owner, 2026-10-25)
_GONE = (404, 410)
_HIDDEN = {"script", "style", "template", "title"}
# Tags that break text apart on screen; inline tags (code, em, a) join their text to
# what is around them, as "Re<em>act</em>ive" reads "Reactive".
_BLOCKS = {
    "address", "article", "aside", "blockquote", "br", "dd", "details", "div", "dl",
    "dt", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6",
    "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "summary",
    "table", "td", "th", "tr", "ul",
}  # fmt: skip


@dataclass(frozen=True)
class Verdict:
    passed: bool
    reason: str | None  # why it failed


class _Page(HTMLParser):
    """The visible text, and where each id starts in it."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.chunks: list[str] = []
        # The first element with an id wins, as in HTML; a hidden one can't be
        # scrolled to.
        self.ids: dict[str, int] = {}
        self._hidden = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _HIDDEN:
            self._hidden += 1
        if tag in _BLOCKS:
            self.chunks.append(" ")
        if self._hidden == 0:
            for name, value in attrs:
                if name == "id" and value is not None:
                    self.ids.setdefault(value, len(self.chunks))

    def handle_endtag(self, tag: str) -> None:
        if tag in _HIDDEN and self._hidden > 0:
            self._hidden -= 1
        if tag in _BLOCKS:
            self.chunks.append(" ")

    def handle_data(self, data: str) -> None:
        if self._hidden == 0:
            self.chunks.append(data)

    def text_from(self, start: int) -> str:
        return heading_key("".join(self.chunks[start:]))


def _parse(html: bytes, encoding: str | None) -> _Page:
    try:
        text = html.decode(encoding or "utf-8", errors="replace")
    except LookupError:
        log.warn("links: unknown charset, reading as utf-8", encoding=encoding)
        text = html.decode("utf-8", errors="replace")
    parsed = _Page()
    parsed.feed(text)
    parsed.close()
    return parsed


def _starts_with_title(text: str, title: str) -> bool:
    # A permalink glyph may come before the heading text (Sphinx, Hugo). A prefix
    # match: "Safety" passes against "Safety guarantees", accepted as close enough.
    return text.lstrip(PERMALINK_GLYPHS + " ").startswith(heading_key(title))


def _verdict(page: _Page, page_text: str, moment: MomentLink) -> Verdict:
    fragment = moment.link.split("#", 1)[1] if "#" in moment.link else ""
    if moment.link_type == "anchor":
        # Browsers try the decoded fragment, then the raw one.
        start = page.ids.get(unquote(fragment), page.ids.get(fragment))
        if start is None:
            return Verdict(False, "missing-anchor")
        if not _starts_with_title(page.text_from(start), moment.title):
            return Verdict(False, "anchor-text-mismatch")
        return Verdict(True, None)
    if moment.link_type == "text_fragment":
        # segment.text_fragment builds only ":~:text=<start>", never prefix or end.
        wanted = (
            heading_key(unquote(fragment.split(":~:text=", 1)[1]))
            if ":~:text=" in fragment
            else ""
        )
        if not wanted or wanted not in page_text:
            return Verdict(False, "text-not-found")
        return Verdict(True, None)
    # page_top points at the top by construction, and its title is the feed's, which
    # often differs from the page's text: the page loading is enough (owner,
    # 2026-10-26).
    return Verdict(True, None)


def check_page(html: bytes, encoding: str | None, moment: MomentLink) -> Verdict:
    page = _parse(html, encoding)
    return _verdict(page, page.text_from(0), moment)


class MomentLinks(Protocol):
    def links(self, source_id: int | None) -> list[MomentLink]: ...


type Outcome = Literal["passed", "failed", "unchecked"]


class SourceReport(TypedDict):
    source_id: int
    source_name: str
    passed: int
    failed: int
    unchecked: int
    pass_rate: float | None  # None when nothing could be checked
    flagged: bool  # under PASS_RATE: the owner switches its moments off


class MomentReport(TypedDict):
    moment_id: int
    item_id: int
    source_id: int
    link: str
    outcome: Outcome
    reason: str


class Report(TypedDict):
    sources: list[SourceReport]
    flagged: list[str]  # source names
    moments: list[MomentReport]  # every moment that didn't pass


def _fetch_failure(error: FetchError) -> tuple[Outcome, str]:
    if isinstance(error, RobotsDisallowed):
        return "unchecked", "robots"
    if isinstance(error, FetchStatusError):
        outcome: Outcome = "failed" if error.status in _GONE else "unchecked"
        return outcome, f"http-{error.status}"
    return "unchecked", "fetch-error"


def _page_url(link: MomentLink) -> str:
    return link.link.split("#", 1)[0]


def _check_page_moments(
    fetcher: Fetcher, url: str, moments: Iterable[MomentLink]
) -> list[tuple[MomentLink, Outcome, str | None]]:
    try:
        fetched = fetcher.fetch(url, "article")
    except FetchError as error:
        outcome, reason = _fetch_failure(error)
        log.warn("links: page not checked", url=url, reason=reason, error=str(error))
        return [(m, outcome, reason) for m in moments]
    page = _parse(fetched.body, fetched.encoding)
    page_text = page.text_from(0)
    results: list[tuple[MomentLink, Outcome, str | None]] = []
    for moment in moments:
        verdict = _verdict(page, page_text, moment)
        results.append(
            (moment, "passed" if verdict.passed else "failed", verdict.reason)
        )
    return results


def check_links(
    moments: MomentLinks, fetcher: Fetcher, source_id: int | None
) -> Report:
    """Fetches each page once, however many of its sections are moments."""
    links = moments.links(source_id)
    by_page = sorted(links, key=_page_url)
    results = [
        result
        for url, group in groupby(by_page, key=_page_url)
        for result in _check_page_moments(fetcher, url, group)
    ]
    sources: dict[int, SourceReport] = {}
    failures: list[MomentReport] = []
    for moment, outcome, reason in sorted(results, key=lambda r: r[0].moment_id):
        source = sources.setdefault(
            moment.source_id,
            SourceReport(
                source_id=moment.source_id,
                source_name=moment.source_name,
                passed=0,
                failed=0,
                unchecked=0,
                pass_rate=None,
                flagged=False,
            ),
        )
        source[outcome] += 1
        if outcome != "passed" and reason is not None:
            failures.append(
                MomentReport(
                    moment_id=moment.moment_id,
                    item_id=moment.item_id,
                    source_id=moment.source_id,
                    link=moment.link,
                    outcome=outcome,
                    reason=reason,
                )
            )
    for source in sources.values():
        checked = source["passed"] + source["failed"]
        if checked:
            source["pass_rate"] = source["passed"] / checked
            source["flagged"] = source["pass_rate"] < PASS_RATE
    ordered = sorted(sources.values(), key=lambda s: s["source_id"])
    return Report(
        sources=ordered,
        flagged=[s["source_name"] for s in ordered if s["flagged"]],
        moments=failures,
    )
