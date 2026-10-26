"""The polite fetcher (ING-1): robots.txt on every hop, per-domain spacing, conditional
requests and an honest user agent. httpx's mock transport plays the publishers."""

import itertools
from collections.abc import Callable

import httpx
import pytest

from interval_jobs.adapters.http_fetcher import HttpxFetcher
from interval_jobs.adapters.polite_fetcher import PoliteFetcher
from interval_jobs.ports import FetchError, RobotsDisallowed, Validators

from .support import public

FEED = "https://blog.example.test/feed.atom"
POST = "https://blog.example.test/posts/wal"
PRIVATE = "https://blog.example.test/drafts/secret"
UA = "Interval/0.0 (personal learning platform; feed reader)"

ROBOTS = b"""User-agent: *
Disallow: /drafts/
"""


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0
        self.slept: list[float] = []
        self.requests: list[tuple[str, float]] = []  # (host, time) per request

    def time(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds

    def gaps(self, host: str) -> list[float]:
        times = [at for h, at in self.requests if h == host]
        return [later - earlier for earlier, later in itertools.pairwise(times)]


Handler = Callable[[httpx.Request], httpx.Response]


def site(
    robots: httpx.Response | None = None,
    etag: str = '"v1"',
    clock: Clock | None = None,
    redirects: dict[str, str] | None = None,
) -> tuple[Handler, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if clock is not None:
            clock.requests.append((request.url.host, clock.now))
        path = request.url.path
        target = (redirects or {}).get(str(request.url))
        if target is not None:
            return httpx.Response(301, headers={"location": target})
        if path == "/robots.txt":
            return robots or httpx.Response(
                200, headers={"content-type": "text/plain"}, content=ROBOTS
            )
        if path.endswith(".atom"):
            if request.headers.get("if-none-match") == etag:
                return httpx.Response(304)
            return httpx.Response(
                200,
                headers={"content-type": "application/atom+xml", "etag": etag},
                content=b"<feed/>",
            )
        return httpx.Response(
            200, headers={"content-type": "text/html"}, content=b"<p/>"
        )

    return handle, seen


def polite(handler: Handler, clock: Clock) -> PoliteFetcher:
    http = httpx.Client(
        transport=httpx.MockTransport(handler), headers={"user-agent": UA}
    )
    return PoliteFetcher(
        HttpxFetcher(http, resolve=public), clock=clock.time, sleep=clock.sleep
    )


def robots_file(text: bytes, content_type: str | None = "text/plain") -> httpx.Response:
    headers = {"content-type": content_type} if content_type else {}
    return httpx.Response(200, headers=headers, content=text)


def test_a_path_robots_disallows_is_never_fetched() -> None:
    handler, seen = site()
    fetcher = polite(handler, Clock())
    with pytest.raises(RobotsDisallowed):
        fetcher.fetch(PRIVATE, "article")
    assert [r.url.path for r in seen] == ["/robots.txt"]


def test_robots_is_read_once_per_host() -> None:
    handler, seen = site()
    fetcher = polite(handler, Clock())
    fetcher.fetch(POST, "article")
    fetcher.fetch(FEED, "feed")
    assert [r.url.path for r in seen].count("/robots.txt") == 1


def test_a_missing_robots_file_allows_everything() -> None:
    handler, _ = site(robots=httpx.Response(404))
    polite(handler, Clock()).fetch(PRIVATE, "article")


@pytest.mark.parametrize("status", [429, 503])
def test_a_busy_or_failing_robots_file_is_retried_later_not_ignored(
    status: int,
) -> None:
    handler, seen = site(robots=httpx.Response(status))
    with pytest.raises(FetchError):
        polite(handler, Clock()).fetch(POST, "article")
    assert [r.url.path for r in seen] == ["/robots.txt"]


def test_an_html_page_at_robots_txt_allows_everything() -> None:
    page = robots_file(b"<!DOCTYPE html><p>Disallow: /</p>", "text/html")
    handler, _ = site(robots=page)
    polite(handler, Clock()).fetch(PRIVATE, "article")


@pytest.mark.parametrize("content_type", [None, "application/octet-stream"])
def test_robots_rules_count_whatever_their_content_type(
    content_type: str | None,
) -> None:
    handler, _ = site(robots=robots_file(ROBOTS, content_type))
    with pytest.raises(RobotsDisallowed):
        polite(handler, Clock()).fetch(PRIVATE, "article")


def test_a_redirect_is_checked_against_the_target_hosts_robots() -> None:
    elsewhere = "https://cdn.example.test/drafts/secret"
    handler, seen = site(redirects={POST: elsewhere})
    with pytest.raises(RobotsDisallowed):
        polite(handler, Clock()).fetch(POST, "article")
    assert [str(r.url) for r in seen][-1] == "https://cdn.example.test/robots.txt"


def test_every_request_to_one_domain_is_a_second_after_the_last() -> None:
    clock = Clock()
    handler, _ = site(clock=clock)
    fetcher = polite(handler, clock)
    fetcher.fetch(POST, "article")
    fetcher.fetch(FEED, "feed")
    gaps = clock.gaps("blog.example.test")
    assert len(gaps) == 2 and min(gaps) >= 1.0


def test_requests_to_different_domains_do_not_wait_for_each_other() -> None:
    clock = Clock()
    handler, _ = site(clock=clock)
    fetcher = polite(handler, clock)
    fetcher.fetch(POST, "article")
    fetcher.fetch("https://other.example.test/posts/x", "article")
    # Each host's robots.txt and page are spaced; the second host never waits on the
    # first one's turn.
    assert clock.slept == [1.0, 1.0]


def test_crawl_delay_is_honored_up_to_a_cap() -> None:
    clock = Clock()
    handler, _ = site(robots=robots_file(b"User-agent: *\nCrawl-delay: 2.5\n"))
    fetcher = polite(handler, clock)
    fetcher.fetch(POST, "article")
    fetcher.fetch(FEED, "feed")
    assert clock.slept[-1] == 2.5
    clock = Clock()
    handler, _ = site(robots=robots_file(b"User-agent: *\nCrawl-delay: 3600\n"))
    fetcher = polite(handler, clock)
    fetcher.fetch(POST, "article")
    fetcher.fetch(FEED, "feed")
    assert max(clock.slept) == 60.0


def test_an_unchanged_feed_is_a_304_and_nothing_to_do() -> None:
    handler, seen = site()
    fetcher = polite(handler, Clock())
    first = fetcher.fetch_if_changed(FEED, "feed", None)
    assert first is not None and first.body == b"<feed/>"
    assert first.validators == Validators('"v1"', None)
    assert fetcher.fetch_if_changed(FEED, "feed", first.validators) is None
    assert seen[-1].headers["if-none-match"] == '"v1"'


def test_a_304_to_a_plain_request_is_an_error_not_a_missing_page() -> None:
    handler, _ = site(redirects={})

    def always_304(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            return handler(request)
        return httpx.Response(304)

    with pytest.raises(FetchError, match="304"):
        polite(always_304, Clock()).fetch(POST, "article")


def test_every_request_says_it_is_interval() -> None:
    handler, seen = site()
    polite(handler, Clock()).fetch(POST, "article")
    assert all(r.headers["user-agent"].startswith("Interval/") for r in seen)


def test_a_status_check_honours_robots_and_spacing() -> None:
    clock = Clock()
    handler, seen = site(clock=clock)
    fetcher = polite(handler, clock)
    with pytest.raises(RobotsDisallowed):
        fetcher.check(PRIVATE)
    fetcher.check("https://blog.example.test/one")
    fetcher.check("https://blog.example.test/two")
    assert [r.url.path for r in seen] == ["/robots.txt", "/one", "/two"]
    assert all(gap >= 1.0 for gap in clock.gaps("blog.example.test"))
