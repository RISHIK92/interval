"""BullMQ on Valkey (ADR-0014): the queue for local development and the VM.

BullMQ's Python package is asyncio-only and the worker's stages are synchronous, so
enqueueing runs on a private event loop thread and consuming runs each handler through
asyncio.to_thread (ADR-0014's answer). The package ships no type information; the
protocols below name the calls this adapter makes.
"""

import asyncio
import threading
from collections.abc import Awaitable, Callable, Coroutine, Mapping
from concurrent.futures import Future
from typing import Any, Protocol, cast

import bullmq  # pyright: ignore[reportMissingTypeStubs]

from interval_db.messages import MessageName
from interval_jobs import log
from interval_jobs.ports import Delivery, QueueHandler
from interval_jobs.queue import ATTEMPTS, parse, prepare

# Retries back off exponentially from 30 s (the gap between retries is engine-specific;
# SQS uses the visibility timeout).
BACKOFF_MS = 30_000
# Jobs that are still to run, in BullMQ's state names.
UNFINISHED = ("waiting", "active", "delayed", "prioritized", "waiting-children")


class _Job(Protocol):
    id: str
    data: dict[str, object]
    attemptsMade: int

    def isFailed(self) -> Awaitable[bool]: ...
    def remove(self) -> Awaitable[object]: ...


class _Queue(Protocol):
    def add(
        self, name: str, data: dict[str, object], opts: dict[str, object]
    ) -> Awaitable[object]: ...
    def getJobCounts(self, *types: str) -> Awaitable[dict[str, int]]: ...
    def getJobs(self, types: list[str]) -> Awaitable[list[_Job]]: ...
    def getJob(self, job_id: str) -> Awaitable[_Job | None]: ...
    def obliterate(self, force: bool = False) -> Awaitable[object]: ...
    def close(self) -> Awaitable[None]: ...


class _Worker(Protocol):
    running: bool

    def close(self, force: bool = False) -> Awaitable[None]: ...
    def on(self, event: str, listener: Callable[..., None]) -> object: ...


def _new_queue(name: str, url: str, prefix: str) -> _Queue:
    return cast(_Queue, bullmq.Queue(name, {"connection": url, "prefix": prefix}))


class BullmqQueue:
    """The enqueue side, callable from synchronous code."""

    def __init__(
        self, url: str, prefix: str = "bull", backoff_ms: int = BACKOFF_MS
    ) -> None:
        self._url = url
        self._prefix = prefix
        self._backoff_ms = backoff_ms
        self._queues: dict[str, _Queue] = {}
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self._loop.run_forever, daemon=True)
        self._thread.start()

    def _run[T](self, work: Coroutine[Any, Any, T]) -> T:
        future: Future[T] = asyncio.run_coroutine_threadsafe(work, self._loop)
        try:
            return future.result(timeout=30)
        except TimeoutError:
            future.cancel()  # so a late add can't land after the caller gave up
            raise

    async def _queue(self, name: str) -> _Queue:
        # Created on the loop thread: the Valkey connection belongs to that loop.
        if name not in self._queues:
            self._queues[name] = _new_queue(name, self._url, self._prefix)
        return self._queues[name]

    def enqueue(
        self,
        name: MessageName,
        message: Mapping[str, object],
        idempotency_key: str,
        delay_seconds: int = 0,
    ) -> None:
        payload = prepare(name, message, idempotency_key, delay_seconds)
        options: dict[str, object] = {
            # BullMQ ignores a jobId that already exists: dedupe while it's pending.
            "jobId": idempotency_key,
            "attempts": ATTEMPTS,
            "backoff": {"type": "exponential", "delay": self._backoff_ms},
            "delay": delay_seconds * 1000,
            "removeOnComplete": True,
            # The failed set is the dead-letter store, kept like the SQS DLQ: 14 days,
            # and bounded so a poll that keeps failing can't grow it forever.
            "removeOnFail": {"age": 14 * 24 * 3600, "count": 1000},
        }

        async def add() -> None:
            queue = await self._queue(name)
            # A failed job keeps its id, which would silently swallow a re-enqueue
            # (say, after a fix); it has given up, so it makes way for the new one.
            existing = await queue.getJob(idempotency_key)
            if existing is not None and await existing.isFailed():
                await existing.remove()
            await queue.add(name, payload, options)

        self._run(add())

    def unfinished(self, name: MessageName) -> int:
        async def count() -> int:
            counts = await (await self._queue(name)).getJobCounts(*UNFINISHED)
            return sum(counts.values())

        return self._run(count())

    def failed_messages(self, name: MessageName) -> list[dict[str, object]]:
        async def failed() -> list[dict[str, object]]:
            jobs = await (await self._queue(name)).getJobs(["failed"])
            return [job.data for job in jobs]

        return self._run(failed())

    def close(self, delete: bool = False) -> None:
        """Closes connections; `delete` also removes the queues' keys (tests)."""

        async def close_all() -> None:
            for queue in self._queues.values():
                if delete:
                    await queue.obliterate(force=True)
                await queue.close()

        try:
            self._run(close_all())
        finally:
            self._loop.call_soon_threadsafe(self._loop.stop)
            self._thread.join(timeout=5)
            self._loop.close()


class BullmqConsumer:
    def __init__(self, url: str, prefix: str = "bull", concurrency: int = 1) -> None:
        self._url = url
        self._prefix = prefix
        self._concurrency = concurrency

    def consume(
        self, name: MessageName, handler: QueueHandler, stop: threading.Event
    ) -> None:
        asyncio.run(self._consume(name, handler, stop))

    async def _consume(
        self, name: MessageName, handler: QueueHandler, stop: threading.Event
    ) -> None:
        async def process(job: _Job, _token: str) -> None:
            # attemptsMade counts finished attempts, so this one is the next.
            delivery = Delivery(job.attemptsMade + 1, job.id)
            await asyncio.to_thread(handler, parse(name, job.data), delivery)

        # BullMQ drops events nobody listens to; failures must reach the log.
        def failed(job: _Job, error: BaseException) -> None:
            log.error(
                "queue: delivery failed",
                queue=name,
                attempt=job.attemptsMade,
                error=error,
            )

        def errored(error: BaseException, *_job: object) -> None:
            log.error("queue: worker error", queue=name, error=error)

        worker = cast(
            _Worker,
            bullmq.Worker(
                name,
                # Its annotation says Future; it awaits any coroutine function.
                cast(Callable[..., "asyncio.Future[None]"], process),
                {
                    "connection": self._url,
                    "prefix": self._prefix,
                    "concurrency": self._concurrency,
                },
            ),
        )
        worker.on("failed", failed)
        worker.on("error", errored)
        try:
            started = False
            while not stop.is_set():
                await asyncio.sleep(0.1)
                started = started or worker.running
                # BullMQ's run loop can end on its own (it swallows its errors); a
                # consumer that silently processes nothing must fail so it restarts.
                if started and not worker.running and not stop.is_set():
                    raise RuntimeError(f"BullMQ worker for {name} stopped")
        finally:
            await worker.close()
