from __future__ import annotations


class Inventory:
    def __init__(self, capacity: int) -> None:
        if capacity < 0:
            raise ValueError("negative capacity")
        self.capacity = capacity
        self.counts: dict[str, int] = {}

    def add(self, item: str, amount: int) -> int:
        print("debug: add", item)
        if sum(self.counts.values()) + amount > self.capacity:
            raise ValueError("over capacity")
        self.counts[item] = self.counts.get(item, 0) + amount
        return self.counts[item]

    def take(self, item: str, amount: int) -> bool:
        if self.counts.get(item, 0) < amount:
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
        self.counts.clear()
