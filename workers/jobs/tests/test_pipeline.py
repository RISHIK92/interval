"""The staged ingestion pipeline (ING-1, LOAD-3, LOAD-5) on in-memory ports: every
stage retryable and idempotent, failures to the failed store, rights checked first."""

import threading
from collections.abc import Generator, Mapping
from contextlib import contextmanager
from datetime import timedelta

import pytest

from interval_db.generated import RightsProfile
from interval_db.messages import MessageName
from interval_jobs.adapters.memory import FakeFetcher, InMemoryStore
from interval_jobs.adapters.memory_queue import InMemoryQueue
from interval_jobs.adapters.trafilatura_extractor import TrafilaturaExtractor
from interval_jobs.pipeline import STAGES, Pipeline, StageServices
from interval_jobs.ports import (
    Fetched,
    FetchError,
    RobotsDisallowed,
    Validators,
)

from .conftest import fixture_bytes

FEED_URL = "https://pipe.example.test/feed.atom"
OLDER = "https://blog.example.test/older-queues"
WAL = "https://blog.example.test/wal"
ETAG = Validators('"feed-v1"', None)


def web(failing: str | None = None, blocked: str | None = None) -> FakeFetcher:
    pages: dict[str, Fetched | FetchError] = {
        FEED_URL: Fetched(FEED_URL, fixture_bytes("atom.xml"), "utf-8", ETAG),
        OLDER: Fetched(OLDER, fixture_bytes("article_v2.html"), "utf-8"),
        WAL: Fetched(WAL, fixture_bytes("article.html"), "utf-8"),
    }
    if failing is not None:
        pages[failing] = FetchError("HTTP 503")
    if blocked is not None:
        pages[blocked] = RobotsDisallowed("robots.txt disallows it")
    return FakeFetcher(pages)


class World:
    def __init__(
        self,
        profile: RightsProfile = "full_text_internal",
        moments: bool = True,
        failing: str | None = None,
        blocked: str | None = None,
    ) -> None:
        self.store = InMemoryStore()
        self.fetcher = web(failing, blocked)
        self.queue = InMemoryQueue()
        self.source_id = self.store.sources.upsert(
            name="pipe", feed_url=FEED_URL, rights_profile=profile, homepage=None
        )
        self.store.sources.set_moments_enabled(self.source_id, moments)

        @contextmanager
        def unit() -> Generator[StageServices]:
            yield StageServices(self.store, self.fetcher, TrafilaturaExtractor())

        self.pipeline = Pipeline(unit, self.queue)

    def discover(self, key: str = "poll-1") -> None:
        self.queue.enqueue(
            "discover_source", {"source_id": self.source_id}, idempotency_key=key
        )

    def run(self) -> None:
        """Delivers every stage until all queues are empty."""
        handlers = self.pipeline.handlers()
        while any(self.queue.pending(name) for name in STAGES):
            for name in STAGES:
                self.queue.consume(name, handlers[name], threading.Event())

    def requested(self) -> list[str]:
        return [url for url, _ in self.fetcher.requested]


def test_a_full_text_source_flows_from_discovery_to_moments_and_the_feed() -> None:
    world = World()
    world.discover()
    world.run()
    items = world.store.items.rows.values()
    assert sorted(i.canonical_url for i in items) == [OLDER, WAL]
    assert all(i.full_text for i in items)
    assert world.store.moments.rows, "segmentation produced moments"
    assert world.store.feed.entries, "the feed was rebuilt"


def test_redelivered_messages_create_nothing_twice() -> None:
    world = World()
    world.discover("poll-1")
    world.run()
    moments = len(world.store.moments.rows)
    world.discover("poll-2")  # a later poll of an unchanged feed
    world.run()
    assert len(world.store.items.rows) == 2
    assert len(world.store.moments.rows) == moments
    # Bodies already stored aren't fetched again.
    assert world.requested().count(WAL) == 1


def test_metadata_only_sources_never_fetch_bodies() -> None:
    world = World(profile="metadata_only", moments=False)
    world.discover()
    world.run()
    assert len(world.store.items.rows) == 2
    assert world.requested() == [FEED_URL]
    assert all(i.full_text is None for i in world.store.items.rows.values())


def test_excerpt_sources_fetch_each_article_once() -> None:
    world = World(profile="excerpt", moments=False)
    world.discover("poll-1")
    world.run()
    world.discover("poll-2")
    world.run()
    assert all(i.excerpt for i in world.store.items.rows.values())
    assert world.requested().count(WAL) == 1


def test_a_stale_fetch_does_nothing_once_the_profile_forbids_bodies() -> None:
    world = World(profile="metadata_only", moments=False)
    world.discover()
    world.run()
    item_id = next(iter(world.store.items.rows))
    # Sent before the profile was lowered: it must not fetch.
    world.queue.enqueue(
        "fetch_item", {"content_item_id": item_id}, idempotency_key="old"
    )
    world.run()
    assert world.requested() == [FEED_URL]


def test_a_stale_segment_makes_no_moments_once_moments_are_off() -> None:
    world = World()
    world.discover()
    world.run()
    assert world.store.moments.rows
    world.store.sources.set_moments_enabled(world.source_id, False)  # purges them
    item_id = next(iter(world.store.items.rows))
    world.queue.enqueue(
        "segment_item", {"content_item_id": item_id}, idempotency_key="old"
    )
    world.run()
    assert world.store.moments.rows == []


def test_an_item_whose_segmenting_failed_is_segmented_on_the_next_full_poll() -> None:
    world = World()
    world.discover("poll-1")
    # Fetch only: segmentation never ran (as if it had landed in the failed store).
    handlers = world.pipeline.handlers()
    for name in ("discover_source", "fetch_item"):
        world.queue.consume(name, handlers[name], threading.Event())
    world.queue.drop_pending("segment_item")
    assert world.store.moments.rows == []
    world.discover("poll-2")  # same day: the feed answers 304
    world.run()
    assert world.store.moments.rows == []
    validators, stored = world.store.validators.rows[FEED_URL]
    world.store.validators.rows[FEED_URL] = (validators, stored - timedelta(days=2))
    world.discover("poll-3")  # a day on: a full fetch re-queues the segment
    world.run()
    assert world.store.moments.rows


def test_a_feed_with_no_valid_entries_is_logged_not_retried(
    capsys: pytest.CaptureFixture[str],
) -> None:
    world = World()
    world.fetcher = FakeFetcher(
        {FEED_URL: Fetched(FEED_URL, fixture_bytes("empty.xml"), "utf-8")}
    )
    world.discover()
    world.run()
    # Permanent: no point retrying it or filling the failed store every poll.
    assert world.queue.failed_messages("discover_source") == []
    assert world.requested() == [FEED_URL]
    assert "pipeline: feed has no valid entry" in capsys.readouterr().out


def test_an_inactive_source_is_not_polled() -> None:
    world = World()
    world.store.sources.rows[world.source_id].active = False
    world.discover()
    world.run()
    assert world.requested() == []


def test_a_stage_failing_three_times_lands_in_the_failed_store() -> None:
    world = World(failing=OLDER)
    world.discover()
    world.run()
    failed = world.queue.failed_messages("fetch_item")
    assert len(failed) == 1
    # The other item went through.
    wal = next(i for i in world.store.items.rows.values() if i.canonical_url == WAL)
    assert wal.full_text
    assert world.requested().count(OLDER) == 3


def test_an_unchanged_feed_costs_one_request_and_does_nothing() -> None:
    world = World()
    world.discover("poll-1")
    world.run()
    before = len(world.fetcher.requested)
    world.discover("poll-2")  # the fake answers 304 to the stored ETag
    world.run()
    assert world.fetcher.requested[before:] == [(FEED_URL, "feed")]


def test_a_discover_retried_after_a_failed_enqueue_still_queues_the_items() -> None:
    world = World()
    enqueue = world.queue.enqueue
    failures = [RuntimeError("queue unavailable")]

    def flaky(
        name: MessageName,
        message: Mapping[str, object],
        idempotency_key: str,
        delay_seconds: int = 0,
    ) -> None:
        if name == "fetch_item" and failures:
            raise failures.pop()
        enqueue(name, message, idempotency_key, delay_seconds)

    world.queue.enqueue = flaky  # type: ignore[method-assign]
    world.discover()
    world.run()
    # The retry fetched the feed again instead of being told "304, nothing new".
    assert all(i.full_text for i in world.store.items.rows.values())
    assert world.store.validators.get(FEED_URL) == ETAG


def test_an_article_robots_disallows_is_skipped_not_retried() -> None:
    world = World(blocked=OLDER)
    world.discover()
    world.run()
    assert world.queue.failed_messages("fetch_item") == []
    assert world.requested().count(OLDER) == 1
