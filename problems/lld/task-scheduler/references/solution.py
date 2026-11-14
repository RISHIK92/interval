from __future__ import annotations

import threading


class TaskScheduler:
    def __init__(self) -> None:
        # Insertion order is the order of adding, which breaks priority ties.
        # id -> [priority, deps, state], state one of queued, running, done, cancelled.
        self.tasks: dict[str, list] = {}
        self.lock = threading.Lock()

    def _ready(self, task: list) -> bool:
        return task[2] == "queued" and all(self.tasks[d][2] == "done" for d in task[1])

    def add(self, id: str, priority: int, deps: list[str]) -> None:
        with self.lock:
            if id in self.tasks:
                raise ValueError("duplicate id")
            if any(d not in self.tasks for d in deps):
                raise ValueError("unknown dependency")
            self.tasks[id] = [priority, list(deps), "queued"]

    def next(self) -> str | None:
        with self.lock:
            best: str | None = None
            for id, task in self.tasks.items():
                # Strictly greater, so the earliest added keeps a tie.
                if self._ready(task) and (best is None or task[0] > self.tasks[best][0]):
                    best = id
            if best is not None:
                self.tasks[best][2] = "running"
            return best

    def complete(self, id: str) -> None:
        with self.lock:
            task = self.tasks.get(id)
            if task is None or task[2] != "running":
                raise ValueError("not running")
            task[2] = "done"

    def status(self, id: str) -> str:
        with self.lock:
            task = self.tasks.get(id)
            if task is None:
                raise ValueError("unknown id")
            if task[2] == "queued":
                return "ready" if self._ready(task) else "waiting"
            return task[2]

    # The extension round.
    def cancel(self, id: str) -> int:
        with self.lock:
            task = self.tasks.get(id)
            if task is None:
                raise ValueError("unknown id")
            if task[2] == "done":
                raise ValueError("already done")
            if task[2] == "cancelled":
                return 0
            # Dependencies are always added first, so one pass in order finds every dependent.
            gone = {id}
            task[2] = "cancelled"
            for other, t in self.tasks.items():
                if t[2] == "queued" and any(d in gone for d in t[1]):
                    t[2] = "cancelled"
                    gone.add(other)
            return len(gone)
