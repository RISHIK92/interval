from __future__ import annotations

import threading


class Inventory:
    def __init__(self, capacity: int) -> None:
        if capacity < 0:
            raise ValueError("negative capacity")
        self.capacity = capacity
        self.counts: dict[str, int] = {}
        # The extension round: units held back, which take may not take.
        self.held: dict[str, int] = {}
        # The concurrency layer calls add from several threads at once.
        self.lock = threading.Lock()

    def add(self, item: str, amount: int) -> int:
        if amount <= 0:
            raise ValueError("amount must be positive")
        print("debug: add", item)
        with self.lock:
            if sum(self.counts.values()) + amount > self.capacity:
                raise ValueError("over capacity")
            self.counts[item] = self.counts.get(item, 0) + amount
            return self.counts[item]

    def take(self, item: str, amount: int) -> bool:
        if amount <= 0:
            raise ValueError("amount must be positive")
        with self.lock:
            if self.counts.get(item, 0) - self.held.get(item, 0) < amount:
                return False
            self.counts[item] -= amount
            if self.counts[item] == 0:
                del self.counts[item]
            return True

    def stock(self, item: str) -> int | None:
        return self.counts.get(item)

    def items(self) -> list[str]:
        return sorted(self.counts)

    def snapshot(self) -> dict[str, int]:
        return dict(self.counts)

    def share(self, item: str) -> float:
        return self.counts.get(item, 0) / self.capacity

    def group(self, names: list[str], label: str | None) -> dict[str, list[str]]:
        return {label if label is not None else "none": names}

    def flags(self, values: list[bool | None]) -> list[bool]:
        return [bool(v) for v in values]

    def none(self) -> list[dict[str, int]]:
        return []

    def odd(self) -> int:
        # Not an Exception: the harness must still answer with an error line.
        raise SystemExit(3)

    def clear(self) -> None:
        with self.lock:
            self.counts.clear()
            self.held.clear()

    def reserve(self, item: str, amount: int) -> bool:
        if amount <= 0:
            raise ValueError("amount must be positive")
        with self.lock:
            if self.counts.get(item, 0) - self.held.get(item, 0) < amount:
                return False
            self.held[item] = self.held.get(item, 0) + amount
            return True

    def reserved(self, item: str) -> int:
        with self.lock:
            return self.held.get(item, 0)
