"""Adaptive polling (ING-3, P1-W2-S03): each source's interval follows its publishing
rate, and `poll-due` queues the sources whose turn has come."""

import threading
from datetime import UTC, datetime, timedelta

from pydantic import BaseModel

from interval_db.messages import DiscoverSource
from interval_jobs.adapters.memory import InMemoryStore
from interval_jobs.adapters.memory_queue import InMemoryQueue
from interval_jobs.polling import (
    MAX_INTERVAL,
    MIN_INTERVAL,
    START_INTERVAL,
    enqueue_due,
    next_interval,
)
from interval_jobs.ports import Delivery

NOW = datetime(2026, 10, 26, 12, 0, tzinfo=UTC)


def test_frequent_posts_speed_polling_up_to_the_floor() -> None:
    interval = START_INTERVAL
    for _ in range(10):
        interval = next_interval(interval, new_items=3)
    assert interval == MIN_INTERVAL


def test_polls_with_nothing_new_back_off_to_the_ceiling() -> None:
    interval = START_INTERVAL
    for _ in range(20):
        interval = next_interval(interval, new_items=0)
    assert interval == MAX_INTERVAL


def test_one_new_item_halves_and_one_empty_poll_lengthens_by_half() -> None:
    assert next_interval(timedelta(hours=4), new_items=1) == timedelta(hours=2)
    assert next_interval(timedelta(hours=4), new_items=0) == timedelta(hours=6)


def test_bounds_hold_whatever_the_stored_interval() -> None:
    assert next_interval(timedelta(seconds=1), new_items=0) == MIN_INTERVAL
    assert next_interval(timedelta(days=30), new_items=5) == MAX_INTERVAL


def sources(store: InMemoryStore, *names: str) -> list[int]:
    return [
        store.sources.upsert(
            name=name,
            feed_url=f"https://{name}.example.test/feed",
            rights_profile="metadata_only",
            homepage=None,
        )
        for name in names
    ]


def queued(queue: InMemoryQueue) -> list[int]:
    seen: list[int] = []

    def handle(message: BaseModel, delivery: Delivery) -> None:
        assert isinstance(message, DiscoverSource)
        seen.append(message.source_id)

    queue.consume("discover_source", handle, threading.Event())
    return seen


def test_poll_due_queues_each_due_source_once_until_its_next_turn() -> None:
    store, queue = InMemoryStore(), InMemoryQueue()
    a, b = sources(store, "a", "b")
    store.sources.record_poll(b, START_INTERVAL, NOW - timedelta(minutes=30))
    assert enqueue_due(store, queue, NOW) == 1
    # Claimed: the next run a minute later finds nothing due.
    assert enqueue_due(store, queue, NOW + timedelta(minutes=1)) == 0
    assert enqueue_due(store, queue, NOW + timedelta(minutes=31)) == 1
    assert queued(queue) == [a, b]


def test_poll_due_skips_sources_no_longer_in_the_seed_list() -> None:
    store, queue = InMemoryStore(), InMemoryQueue()
    (a,) = sources(store, "gone")
    store.sources.rows[a].active = False
    assert enqueue_due(store, queue, NOW) == 0
