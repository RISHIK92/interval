from __future__ import annotations

import threading
from collections import OrderedDict


class LRUCache:
    def __init__(self, capacity: int) -> None:
        if capacity < 1:
            raise ValueError("capacity must be at least 1")
        self.capacity = capacity
        # Oldest first: the front is the least recently used.
        self.entries: OrderedDict[str, int] = OrderedDict()
        self.lock = threading.Lock()

    def lookup(self, key: str) -> int | None:
        with self.lock:
            if key not in self.entries:
                return None
            self.entries.move_to_end(key)
            return self.entries[key]

    def put(self, key: str, value: int) -> None:
        if value < 0:
            raise ValueError("negative value")
        with self.lock:
            if key in self.entries:
                self.entries.move_to_end(key)
            self.entries[key] = value
            if len(self.entries) > self.capacity:
                self.entries.popitem(last=False)

    def size(self) -> int:
        with self.lock:
            return len(self.entries)

    def keys(self) -> list[str]:
        with self.lock:
            return list(reversed(self.entries))

    # The extension round.
    def resize(self, capacity: int) -> None:
        if capacity < 1:
            raise ValueError("capacity must be at least 1")
        with self.lock:
            self.capacity = capacity
            while len(self.entries) > capacity:
                self.entries.popitem(last=False)

    def peek(self, key: str) -> int | None:
        with self.lock:
            return self.entries.get(key)
