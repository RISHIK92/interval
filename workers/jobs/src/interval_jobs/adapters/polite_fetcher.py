"""A polite fetcher (ING-1): robots.txt, per-domain spacing and conditional requests,
around the guarded HttpxFetcher.

Every hop, redirects included, is checked against its own origin's robots.txt and waits
its host's turn. Spacing is per process (the worker runs one consumer process per
deployment); several consumer processes would each keep their own spacing.
"""

import threading
import time
from collections.abc import Callable
from urllib.parse import urlsplit

from interval_jobs import log
from interval_jobs.adapters.http_fetcher import HttpxFetcher
from interval_jobs.adapters.robots import ALLOW_ALL, Robots, parse
from interval_jobs.ports import (
    Fetched,
    FetchError,
    FetchKind,
    FetchStatusError,
    RobotsDisallowed,
    Validators,
)

# The product token robots.txt groups are matched against (the user agent's first word).
AGENT = "Interval"
# At least this long between two requests to one host, unless Crawl-delay asks more.
MIN_INTERVAL_S = 1.0
# A larger Crawl-delay would hold a stage thread past its message's visibility timeout.
MAX_CRAWL_DELAY_S = 60.0
ROBOTS_TTL_S = 24 * 3600


def _looks_like_html(body: bytes) -> bool:
    head = body.lstrip()[:15].lower()
    return head.startswith((b"<!doctype html", b"<html"))


class PoliteFetcher:
    def __init__(
        self,
        inner: HttpxFetcher,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._inner = inner
        self._clock = clock
        self._sleep = sleep
        self._lock = threading.Lock()  # stage threads share one fetcher
        self._robots: dict[str, tuple[float, Robots]] = {}
        self._next_turn: dict[str, float] = {}

    def fetch(self, url: str, kind: FetchKind) -> Fetched:
        fetched = self._inner.request(url, kind, {}, self._hop)
        if fetched is None:
            raise FetchError(f"{kind} {url}: 304 without a conditional request")
        return fetched

    def check(self, url: str) -> None:
        self._inner.check(url, self._hop)

    def fetch_if_changed(
        self, url: str, kind: FetchKind, known: Validators | None
    ) -> Fetched | None:
        headers: dict[str, str] = {}
        if known is not None and known.etag is not None:
            headers["if-none-match"] = known.etag
        if known is not None and known.last_modified is not None:
            headers["if-modified-since"] = known.last_modified
        return self._inner.request(url, kind, headers, self._hop)

    def _hop(self, url: str) -> None:
        robots = self._robots_for(url)
        if not robots.allows(url):
            raise RobotsDisallowed(f"robots.txt disallows {url}")
        self._wait_turn(url, robots.crawl_delay)

    def _robots_for(self, url: str) -> Robots:
        parts = urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        with self._lock:
            cached = self._robots.get(origin)
        if cached is not None and self._clock() - cached[0] < ROBOTS_TTL_S:
            return cached[1]
        robots = self._read_robots(origin)
        with self._lock:
            self._robots[origin] = (self._clock(), robots)
        return robots

    def _read_robots(self, origin: str) -> Robots:
        try:
            fetched = self._inner.request(
                f"{origin}/robots.txt", "robots", {}, lambda hop: self._wait_turn(hop)
            )
        except FetchStatusError as error:
            # 429 and 5xx: the site is busy or down, so try later rather than guess.
            if error.status == 429 or not 400 <= error.status < 500:
                raise
            return ALLOW_ALL  # no robots.txt: everything allowed (RFC 9309)
        body = fetched.body if fetched is not None else b""
        if _looks_like_html(body):
            # Some sites answer /robots.txt with an HTML page: no rules to honor.
            log.info("fetcher: robots.txt is an HTML page; allowing", origin=origin)
            return ALLOW_ALL
        robots = parse(body.decode("utf-8", "replace"), AGENT)
        if robots.crawl_delay is not None and robots.crawl_delay > MAX_CRAWL_DELAY_S:
            log.info(
                "fetcher: crawl-delay capped",
                origin=origin,
                asked=robots.crawl_delay,
                used=MAX_CRAWL_DELAY_S,
            )
        return robots

    def _wait_turn(self, url: str, crawl_delay: float | None = None) -> None:
        host = urlsplit(url).netloc
        interval = max(MIN_INTERVAL_S, min(crawl_delay or 0.0, MAX_CRAWL_DELAY_S))
        # Reserve the slot under the lock, sleep outside it: a slow host never holds
        # up requests to other hosts.
        with self._lock:
            now = self._clock()
            turn = max(now, self._next_turn.get(host, now))
            self._next_turn[host] = turn + interval
        if turn > now:
            self._sleep(turn - now)
