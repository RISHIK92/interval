from __future__ import annotations

import threading

MAX_SIZE = 1000


class ConnPool:
    def __init__(self, maxSize: int) -> None:
        if not 1 <= maxSize <= MAX_SIZE:
            raise ValueError("maxSize is 1 to 1000")
        self._max = maxSize
        # Every connection ever made, including the discarded ones.
        self._made: set[str] = set()
        # Most recently released last: reusing from the end keeps the warmest connection
        # busy and lets the coldest ones age out.
        self._idle: list[str] = []
        self._held: dict[str, str] = {}
        # One lock around every change, so two threads can never take the same idle
        # connection or both grow the pool past its maximum.
        self._lock = threading.Lock()

    def _known(self, conn: str) -> None:
        if conn not in self._made:
            raise KeyError("not a connection this pool made")

    def acquire(self, client: str) -> str | None:
        if client == "":
            raise ValueError("clients are named")
        with self._lock:
            if self._idle:
                conn = self._idle.pop()
            elif len(self._held) < self._max:
                conn = f"conn-{len(self._made) + 1}"
                self._made.add(conn)
            else:
                return None
            self._held[conn] = client
            return conn

    def release(self, conn: str) -> bool:
        with self._lock:
            self._known(conn)
            if self._held.pop(conn, None) is None:
                return False
            self._idle.append(conn)
            return True

    def invalidate(self, conn: str) -> bool:
        with self._lock:
            self._known(conn)
            if conn in self._idle:
                self._idle.remove(conn)
                return True
            return self._held.pop(conn, None) is not None

    def created(self) -> int:
        return len(self._made)

    def idle(self) -> int:
        return len(self._idle)

    # The extension round: close the coldest idle connections past a limit.
    def shrink(self, maxIdle: int) -> int:
        if maxIdle < 0:
            raise ValueError("maxIdle is not negative")
        with self._lock:
            closing = max(len(self._idle) - maxIdle, 0)
            self._idle = self._idle[closing:]
            return closing
