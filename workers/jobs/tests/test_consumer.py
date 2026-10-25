"""The always-on consumer (ADR-0014): one thread per stage, a span per delivery, a
heartbeat for the container's health check, and a clean stop."""

import threading
import time
from pathlib import Path

import pytest
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from pydantic import BaseModel

from interval_db.messages import DiscoverSource, MessageName
from interval_jobs.consumer import run_consumers
from interval_jobs.ports import Delivery, QueueHandler


class OneMessageConsumer:
    """Delivers one message per queue, then waits for stop like a real consumer."""

    def __init__(self, crash: MessageName | None = None) -> None:
        self._crash = crash

    def consume(
        self, name: MessageName, handler: QueueHandler, stop: threading.Event
    ) -> None:
        if name == self._crash:
            raise ConnectionError("lost Valkey")
        handler(DiscoverSource(source_id=1), Delivery(1, f"key-{name}"))
        stop.wait()


def test_every_stage_is_served_and_each_delivery_gets_a_span(
    spans: InMemorySpanExporter, tmp_path: Path
) -> None:
    seen: list[str] = []

    def recorder(name: MessageName) -> QueueHandler:
        def handle(message: BaseModel, delivery: Delivery) -> None:
            seen.append(name)

        return handle

    handlers: dict[MessageName, QueueHandler] = {
        "discover_source": recorder("discover_source"),
        "fetch_item": recorder("fetch_item"),
    }
    stop = threading.Event()
    heartbeat = tmp_path / "alive"
    runner = threading.Thread(
        target=run_consumers,
        args=(OneMessageConsumer(), handlers, stop, heartbeat),
        kwargs={"beat_seconds": 0.05},
    )
    runner.start()
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline and len(seen) < 2:
        time.sleep(0.02)
    time.sleep(0.1)
    assert heartbeat.exists()
    stop.set()
    runner.join(timeout=5)
    assert not runner.is_alive()
    assert sorted(seen) == ["discover_source", "fetch_item"]
    names = sorted(s.name for s in spans.get_finished_spans())
    assert names == ["stage discover_source", "stage fetch_item"]
    for span in spans.get_finished_spans():
        assert span.attributes is not None
        assert (
            span.attributes["message_id"] == f"key-{span.name.removeprefix('stage ')}"
        )


def test_a_dead_stage_stops_the_consumer_with_an_error(tmp_path: Path) -> None:
    def noop(message: BaseModel, delivery: Delivery) -> None:
        return None

    handlers: dict[MessageName, QueueHandler] = {
        "discover_source": noop,
        "fetch_item": noop,
    }
    with pytest.raises(SystemExit, match="fetch_item"):
        run_consumers(
            OneMessageConsumer(crash="fetch_item"),
            handlers,
            threading.Event(),
            tmp_path / "alive",
            beat_seconds=0.05,
        )
