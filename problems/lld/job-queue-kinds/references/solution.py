from __future__ import annotations

from abc import ABC, abstractmethod
from typing import NamedTuple

MAX_PRIORITY = 10**6
MAX_MS = 10**12


class Job(NamedTuple):
    name: str
    priority: int
    not_before: int
    seq: int


# The contract every kind honours lives here, once: only ready jobs leave, size counts
# every job, a job leaves once, and peeking asks the same question polling does. A kind
# only says which ready job comes first, so it can't break any of that.
class Queue(ABC):
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}

    @abstractmethod
    def order(self, job: Job) -> tuple[int, ...]: ...

    def push(self, job: Job) -> None:
        self._jobs[job.name] = job

    def peek(self, now: int) -> Job | None:
        ready = [job for job in self._jobs.values() if job.not_before <= now]
        return min(ready, key=self.order) if ready else None

    def poll(self, now: int) -> Job | None:
        job = self.peek(now)
        if job is not None:
            del self._jobs[job.name]
        return job

    def remove(self, name: str) -> bool:
        return self._jobs.pop(name, None) is not None

    def size(self) -> int:
        return len(self._jobs)


class FifoQueue(Queue):
    def order(self, job: Job) -> tuple[int, ...]:
        return (job.seq,)


class PriorityQueue(Queue):
    def order(self, job: Job) -> tuple[int, ...]:
        return (-job.priority, job.seq)


class DelayedQueue(Queue):
    def order(self, job: Job) -> tuple[int, ...]:
        return (job.not_before, job.seq)


KINDS: dict[str, type[Queue]] = {"fifo": FifoQueue, "priority": PriorityQueue, "delayed": DelayedQueue}


def _time(ms: int) -> int:
    if not 0 <= ms <= MAX_MS:
        raise ValueError("a time is 0 to 10^12")
    return ms


class JobQueue:
    def __init__(self, kind: str) -> None:
        if kind not in KINDS:
            raise ValueError("an unknown kind")
        self._queue = KINDS[kind]()
        self._used: set[str] = set()

    def push(self, job: str, priority: int, notBeforeMs: int) -> None:
        if job == "" or job in self._used:
            raise ValueError("a job needs a name of its own")
        if not 0 <= priority <= MAX_PRIORITY:
            raise ValueError("a priority is 0 to 10^6")
        self._queue.push(Job(job, priority, _time(notBeforeMs), len(self._used)))
        self._used.add(job)

    def poll(self, nowMs: int) -> str | None:
        found = self._queue.poll(_time(nowMs))
        return found.name if found is not None else None

    def peekAt(self, nowMs: int) -> str | None:
        found = self._queue.peek(_time(nowMs))
        return found.name if found is not None else None

    def size(self) -> int:
        return self._queue.size()

    # The extension round.
    def cancel(self, job: str) -> bool:
        if job == "":
            raise ValueError("an empty job")
        return self._queue.remove(job)
