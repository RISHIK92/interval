"""Deep-link verification (§3.2, ING-4, Q-P1-25, P1-W6-S02): does a moment's link
land on its section? Checked against local fixture pages, each link type passing and
failing, and per source against the 90% pass rate (owner, 2026-10-25)."""

from pathlib import Path

import pytest

from interval_db.generated import MomentLinkType
from interval_jobs.link_check import Verdict, check_links, check_page
from interval_jobs.ports import (
    Fetched,
    FetchError,
    FetchKind,
    FetchStatusError,
    MomentLink,
    RobotsDisallowed,
    Validators,
)
from interval_jobs.segment import text_fragment

FIXTURES = Path(__file__).parent / "fixtures" / "links"


def link(
    url: str,
    title: str,
    link_type: MomentLinkType,
    moment_id: int = 1,
    source_id: int = 1,
) -> MomentLink:
    return MomentLink(
        moment_id=moment_id,
        item_id=moment_id * 10,
        source_id=source_id,
        source_name=f"source-{source_id}",
        title=title,
        link=url,
        link_type=link_type,
    )


def page(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


ANCHORS = "https://blog.example.test/consensus"


@pytest.mark.parametrize(
    ("fragment", "title", "expected"),
    [
        ("why-raft", "Why Raft", Verdict(True, None)),  # the id on the heading
        # The id on a wrapping section; spacing in the page differs.
        ("log-replication", "Log replication", Verdict(True, None)),
        # As segment.py builds it: the id percent-encoded in the link.
        ("caf%C3%A9-rules", "Café rules", Verdict(True, None)),
        ("a%20b", "Raw id", Verdict(True, None)),  # browsers fall back to the raw id
        ("using-fsync", "Using fsync()", Verdict(True, None)),  # inline markup
        ("in-template", "In a template", Verdict(False, "missing-anchor")),
        ("leader-election", "Leader election", Verdict(False, "missing-anchor")),
        ("safety", "Why Raft", Verdict(False, "anchor-text-mismatch")),
    ],
)
def test_anchor_links(fragment: str, title: str, expected: Verdict) -> None:
    moment = link(f"{ANCHORS}#{fragment}", title, "anchor")
    assert check_page(page("anchors.html"), "utf-8", moment) == expected


FRAGMENTS = "https://blog.example.test/queues"


@pytest.mark.parametrize(
    ("heading", "expected"),
    [
        ("Backpressure, explained", Verdict(True, None)),
        ("backpressure,  EXPLAINED", Verdict(True, None)),  # case, spacing
        ("Reactive streams", Verdict(True, None)),  # inline markup inside a word
        ("Write-ahead logs, briefly & why", Verdict(True, None)),  # - , & encoded
        ("Hidden In Script", Verdict(False, "text-not-found")),
        ("Only In A Template", Verdict(False, "text-not-found")),
        ("Leader election", Verdict(False, "text-not-found")),
        ("Textsplit", Verdict(False, "text-not-found")),  # blocks stay apart
    ],
)
def test_text_fragment_links(heading: str, expected: Verdict) -> None:
    url = FRAGMENTS + text_fragment(heading)
    moment = link(url, heading, "text_fragment")
    assert check_page(page("fragments.html"), "utf-8", moment) == expected


def test_a_page_top_link_lands_once_the_page_loads() -> None:
    # It points at the top by construction, and its title is the feed's, which often
    # differs from the page's text (owner, 2026-10-26).
    moment = link("https://blog.example.test/edge", "A feed title", "page_top")
    assert check_page(page("page-top.html"), "utf-8", moment) == Verdict(True, None)


def test_the_document_title_is_not_page_text() -> None:
    moment = link(
        f"{FRAGMENTS}{text_fragment('Only in the title')}",
        "Only in the title",
        "text_fragment",
    )
    assert check_page(page("title-only.html"), "utf-8", moment) == Verdict(
        False, "text-not-found"
    )


def test_an_unknown_charset_is_read_as_utf8() -> None:
    moment = link(f"{ANCHORS}#why-raft", "Why Raft", "anchor")
    assert check_page(page("anchors.html"), "utf8mb4", moment) == Verdict(True, None)


class FakeFetcher:
    def __init__(self, pages: dict[str, bytes | Exception]) -> None:
        self.pages = pages
        self.fetched: list[str] = []

    def fetch(self, url: str, kind: FetchKind) -> Fetched:
        self.fetched.append(url)
        found = self.pages[url]
        if isinstance(found, Exception):
            raise found
        return Fetched(url, found, "utf-8")

    def check(self, url: str) -> bool:
        raise AssertionError("not used")

    def fetch_if_changed(
        self, url: str, kind: FetchKind, known: Validators | None
    ) -> Fetched | None:
        raise AssertionError("not used")


class FakeMoments:
    def __init__(self, links: list[MomentLink]) -> None:
        self._links = links

    def links(self, source_id: int | None) -> list[MomentLink]:
        return [m for m in self._links if source_id in (None, m.source_id)]


def test_each_page_is_fetched_once_for_all_its_moments() -> None:
    fetcher = FakeFetcher({ANCHORS: page("anchors.html")})
    moments = [
        link(f"{ANCHORS}#why-raft", "Why Raft", "anchor", 1),
        link(f"{ANCHORS}#safety", "Safety", "anchor", 2),
    ]
    report = check_links(FakeMoments(moments), fetcher, None)
    assert fetcher.fetched == [ANCHORS]
    assert report["sources"][0]["passed"] == 2


def test_a_missing_page_fails_but_a_page_that_cannot_be_checked_is_unchecked() -> None:
    fetcher = FakeFetcher(
        {
            "https://a.example.test/gone": FetchStatusError("404", 404),
            "https://a.example.test/blocked": RobotsDisallowed("robots"),
            "https://a.example.test/slow": FetchError("timed out"),
            "https://a.example.test/down": FetchStatusError("503", 503),
            ANCHORS: page("anchors.html"),
        }
    )
    moments = [
        link("https://a.example.test/gone", "Gone", "page_top", 1),
        link("https://a.example.test/blocked", "Blocked", "page_top", 2),
        link("https://a.example.test/slow", "Slow", "page_top", 3),
        link("https://a.example.test/down", "Down", "page_top", 4),
        link(f"{ANCHORS}#why-raft", "Why Raft", "anchor", 5),
    ]
    report = check_links(FakeMoments(moments), fetcher, None)
    (only,) = report["sources"]
    assert (only["passed"], only["failed"], only["unchecked"]) == (1, 1, 3)
    assert only["pass_rate"] == 0.5  # unchecked moments are left out
    reasons = {m["moment_id"]: m["reason"] for m in report["moments"]}
    assert reasons == {1: "http-404", 2: "robots", 3: "fetch-error", 4: "http-503"}
    outcomes = {m["moment_id"]: m["outcome"] for m in report["moments"]}
    assert outcomes == {1: "failed", 2: "unchecked", 3: "unchecked", 4: "unchecked"}


def _source(source_id: int, passed: int, failed: int) -> list[MomentLink]:
    good = [
        link(
            f"{ANCHORS}#why-raft", "Why Raft", "anchor", source_id * 100 + i, source_id
        )
        for i in range(passed)
    ]
    bad = [
        link(
            f"{ANCHORS}#nowhere",
            "Nowhere",
            "anchor",
            source_id * 100 + 50 + i,
            source_id,
        )
        for i in range(failed)
    ]
    return good + bad


def test_a_source_under_ninety_percent_is_flagged() -> None:
    fetcher = FakeFetcher({ANCHORS: page("anchors.html")})
    moments = _source(1, 9, 1) + _source(2, 8, 1)  # 90% and 89%
    report = check_links(FakeMoments(moments), fetcher, None)
    flagged = {s["source_id"]: s["flagged"] for s in report["sources"]}
    assert flagged == {1: False, 2: True}
    assert report["flagged"] == ["source-2"]


def test_a_source_with_nothing_checked_has_no_rate_and_is_not_flagged() -> None:
    blocked = "https://a.example.test/blocked"
    fetcher = FakeFetcher({blocked: RobotsDisallowed("robots")})
    report = check_links(
        FakeMoments([link(blocked, "Blocked", "page_top")]), fetcher, None
    )
    (only,) = report["sources"]
    assert (only["pass_rate"], only["flagged"]) == (None, False)


def test_one_source_can_be_checked_alone() -> None:
    fetcher = FakeFetcher({ANCHORS: page("anchors.html")})
    moments = _source(1, 1, 0) + _source(2, 1, 0)
    report = check_links(FakeMoments(moments), fetcher, 2)
    assert [s["source_id"] for s in report["sources"]] == [2]
