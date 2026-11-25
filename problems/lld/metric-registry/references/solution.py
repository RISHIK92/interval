from __future__ import annotations

MAX_STEP = 10**9
MAX_READING = 10**12


class MetricRegistry:
    def __init__(self) -> None:
        self._counters: dict[str, int] = {}
        self._gauges: dict[str, int] = {}

    # A name belongs to one kind for good: the other kind's map must not hold it.
    @staticmethod
    def _claim(name: str, other: dict[str, int]) -> None:
        if name == "" or name in other:
            raise ValueError("a metric needs a non-empty name of its own kind")

    def inc(self, name: str, by: int) -> int:
        if not 1 <= by <= MAX_STEP:
            raise ValueError("a counter goes up by 1 to 10^9")
        self._claim(name, self._gauges)
        self._counters[name] = self._counters.get(name, 0) + by
        return self._counters[name]

    def gauge(self, name: str, value: int) -> None:
        if not -MAX_READING <= value <= MAX_READING:
            raise ValueError("a gauge reads within -10^12 and 10^12")
        self._claim(name, self._counters)
        self._gauges[name] = value

    def read(self, name: str) -> int | None:
        if name in self._counters:
            return self._counters[name]
        return self._gauges.get(name)

    def names(self) -> list[str]:
        return sorted([*self._counters, *self._gauges])

    # The extension round.
    def snapshotAndReset(self) -> dict[str, int]:
        snapshot = dict(self._counters)
        self._counters = dict.fromkeys(snapshot, 0)
        return snapshot
