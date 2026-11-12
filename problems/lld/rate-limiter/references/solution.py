from __future__ import annotations

import threading
from collections import deque


class RateLimiter:
    def __init__(self, limit: int, window_ms: int) -> None:
        if limit < 1 or window_ms < 1:
            raise ValueError("limit and window must be at least 1")
        self.limit = limit
        # The extension round: per-client limits, over the default.
        self.limits: dict[str, int] = {}
        self.window = window_ms
        # Each client's allowed requests, oldest first, and the time of its last call.
        self.log: dict[str, deque[int]] = {}
        self.last: dict[str, int] = {}
        self.lock = threading.Lock()

    def _current(self, client: str, now: int) -> deque[int]:
        if client in self.last and now < self.last[client]:
            raise ValueError("time went backwards")
        self.last[client] = now
        log = self.log.setdefault(client, deque())
        while log and log[0] <= now - self.window:
            log.popleft()
        return log

    def allow(self, client: str, now_ms: int) -> bool:
        with self.lock:
            log = self._current(client, now_ms)
            if len(log) < self.limits.get(client, self.limit):
                log.append(now_ms)
                return True
            return False

    def remaining(self, client: str, now_ms: int) -> int:
        with self.lock:
            # Never below 0: a lowered limit can leave more allowed than it now permits.
            return max(
                0,
                self.limits.get(client, self.limit)
                - len(self._current(client, now_ms)),
            )

    def setLimit(self, client: str, limit: int) -> None:
        if limit < 1:
            raise ValueError("limit must be at least 1")
        with self.lock:
            self.limits[client] = limit

    def limitOf(self, client: str) -> int:
        with self.lock:
            return self.limits.get(client, self.limit)
