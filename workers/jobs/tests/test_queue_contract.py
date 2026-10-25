"""Queue contract (ADR-0014): the same cases against the in-memory fake and BullMQ on
the local Valkey. The SQS adapter has its own stubbed tests (test_sqs_queue.py)."""

import os
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Protocol
from uuid import uuid4

import pytest
from pydantic import BaseModel, ValidationError

from interval_db.messages import DiscoverSource
from interval_jobs.adapters.bullmq_queue import BullmqConsumer, BullmqQueue
from interval_jobs.adapters.memory_queue import InMemoryQueue
from interval_jobs.ports import Delivery, JobQueue, QueueHandler

NAME = "discover_source"


class Engine(Protocol):
    queue: JobQueue

    def deliver(self, handler: QueueHandler) -> None:
        """Delivers until nothing is waiting or due for a retry."""
        ...

    def failed(self) -> list[dict[str, object]]: ...


class MemoryEngine:
    def __init__(self) -> None:
        self.memory = InMemoryQueue()
        self.queue: JobQueue = self.memory

    def deliver(self, handler: QueueHandler) -> None:
        self.memory.consume(NAME, handler, threading.Event())

    def failed(self) -> list[dict[str, object]]:
        return self.memory.failed_messages(NAME)


class BullmqEngine:
    def __init__(self, url: str) -> None:
        # A prefix per test: keys never collide with other tests or real queues.
        prefix = f"test-{uuid4().hex}"
        self.bullmq = BullmqQueue(url, prefix=prefix, backoff_ms=20)
        self.queue: JobQueue = self.bullmq
        self.consumer = BullmqConsumer(url, prefix=prefix)

    def deliver(self, handler: QueueHandler) -> None:
        stop = threading.Event()
        worker = threading.Thread(
            target=self.consumer.consume, args=(NAME, handler, stop)
        )
        worker.start()
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline and self.bullmq.unfinished(NAME) > 0:
            time.sleep(0.05)
        stop.set()
        worker.join(timeout=15)
        assert not worker.is_alive(), "the consumer did not stop"

    def failed(self) -> list[dict[str, object]]:
        return self.bullmq.failed_messages(NAME)


@pytest.fixture(params=["memory", "bullmq"])
def engine(request: pytest.FixtureRequest) -> Iterator[Engine]:
    if request.param == "memory":
        yield MemoryEngine()
        return
    url = os.environ.get("VALKEY_URL")
    assert url, "VALKEY_URL is not set; see .env.example"
    bullmq = BullmqEngine(url)
    try:
        yield bullmq
    finally:
        bullmq.bullmq.close(delete=True)


@dataclass
class Recorder:
    """A handler that fails its first `failures` deliveries, then succeeds."""

    failures: int = 0
    seen: list[tuple[int, int]] = field(default_factory=list[tuple[int, int]])
    keys: list[str] = field(default_factory=list[str])

    def __call__(self, message: BaseModel, delivery: Delivery) -> None:
        assert isinstance(message, DiscoverSource)
        self.seen.append((message.source_id, delivery.attempt))
        self.keys.append(delivery.idempotency_key)
        if len(self.seen) <= self.failures:
            raise RuntimeError("stage failed")


def test_a_message_is_delivered_once_validated(engine: Engine) -> None:
    engine.queue.enqueue(NAME, {"source_id": 7}, idempotency_key="k1")
    handler = Recorder()
    engine.deliver(handler)
    assert handler.seen == [(7, 1)]
    assert handler.keys == ["k1"]
    assert engine.failed() == []


def test_a_failing_message_is_retried_until_it_succeeds(engine: Engine) -> None:
    engine.queue.enqueue(NAME, {"source_id": 7}, idempotency_key="k2")
    handler = Recorder(failures=2)
    engine.deliver(handler)
    assert handler.seen == [(7, 1), (7, 2), (7, 3)]
    assert engine.failed() == []


def test_three_failures_land_in_the_failed_store(engine: Engine) -> None:
    engine.queue.enqueue(NAME, {"source_id": 9}, idempotency_key="k3")
    handler = Recorder(failures=99)
    engine.deliver(handler)
    assert [attempt for _, attempt in handler.seen] == [1, 2, 3]
    assert engine.failed() == [{"source_id": 9}]
    later = Recorder()
    engine.deliver(later)
    assert later.seen == []


def test_every_delivery_carries_its_idempotency_key(engine: Engine) -> None:
    # BullMQ drops the second enqueue, SQS can't: the contract is only that each
    # delivery carries the key, so handlers dedupe on it (LOAD-5).
    engine.queue.enqueue(NAME, {"source_id": 1}, idempotency_key="same")
    engine.queue.enqueue(NAME, {"source_id": 1}, idempotency_key="same")
    handler = Recorder()
    engine.deliver(handler)
    assert handler.keys
    assert set(handler.keys) == {"same"}


def test_a_key_that_failed_can_be_enqueued_again(engine: Engine) -> None:
    engine.queue.enqueue(NAME, {"source_id": 2}, idempotency_key="retry-me")
    engine.deliver(Recorder(failures=99))
    engine.queue.enqueue(NAME, {"source_id": 2}, idempotency_key="retry-me")
    later = Recorder()
    engine.deliver(later)
    assert later.seen == [(2, 1)]


@pytest.mark.parametrize("key", ["", "42", "discover_source:7", "x" * 201])
def test_a_key_the_engines_cant_use_is_refused(engine: Engine, key: str) -> None:
    with pytest.raises(ValueError, match="idempotency_key"):
        engine.queue.enqueue(NAME, {"source_id": 1}, idempotency_key=key)


def test_an_invalid_message_is_refused_at_enqueue(engine: Engine) -> None:
    for bad in ({"source_id": 0}, {"source_id": "7"}, {"source_id": 7, "extra": 1}):
        with pytest.raises(ValidationError):
            engine.queue.enqueue(NAME, bad, idempotency_key="bad")


def test_a_delay_beyond_what_sqs_allows_is_refused(engine: Engine) -> None:
    with pytest.raises(ValueError, match="900"):
        engine.queue.enqueue(
            NAME, {"source_id": 1}, idempotency_key="d", delay_seconds=901
        )
