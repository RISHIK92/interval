"""The always-on consumer (ADR-0014): one thread per stage queue, so a slow stage never
holds up another.

Each delivery is its own trace (OPS-2), tagged with the message's idempotency key. If
any stage's consumer dies, everything stops and the process exits non-zero, so compose
or ECS restarts it instead of it silently serving fewer queues. The main thread touches
a heartbeat file for the health check: a liveness signal for the process, not proof
that every stage is making progress (a stage stuck in a handler keeps it fresh).
"""

import threading
from collections.abc import Mapping
from pathlib import Path

from pydantic import BaseModel

from interval_db.messages import MessageName
from interval_jobs import log
from interval_jobs.ports import Delivery, QueueConsumer, QueueHandler
from interval_jobs.tracing import run_span

BEAT_SECONDS = 30.0


def _traced(name: MessageName, handler: QueueHandler) -> QueueHandler:
    def handle(message: BaseModel, delivery: Delivery) -> None:
        with run_span(f"stage {name}", message_id=delivery.idempotency_key):
            handler(message, delivery)

    return handle


def run_consumers(
    consumer: QueueConsumer,
    handlers: Mapping[MessageName, QueueHandler],
    stop: threading.Event,
    heartbeat: Path,
    beat_seconds: float = BEAT_SECONDS,
) -> None:
    died: list[MessageName] = []

    def serve(name: MessageName, handler: QueueHandler) -> None:
        try:
            consumer.consume(name, _traced(name, handler), stop)
        except Exception as error:
            log.error("consumer: stage stopped", queue=name, error=error)
            died.append(name)
            stop.set()

    threads = [
        threading.Thread(target=serve, args=(name, handler), name=f"consume-{name}")
        for name, handler in handlers.items()
    ]
    for thread in threads:
        thread.start()
    log.info("consumer: started", queues=sorted(handlers))
    while not stop.is_set():
        heartbeat.touch()
        stop.wait(beat_seconds)
    for thread in threads:
        thread.join()
    if died:
        raise SystemExit(f"consumer stopped: {', '.join(sorted(died))} failed")
    log.info("consumer: stopped")
