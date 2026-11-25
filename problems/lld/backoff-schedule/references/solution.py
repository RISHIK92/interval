from __future__ import annotations

from typing import Protocol

MAX_ATTEMPTS = 1000
MAX_CAP_MS = 1_000_000_000


class Growth(Protocol):
    """The one thing that varies between schedules: the delay before an attempt, at most
    `cap`. Each step is capped, so no kind computes huge numbers."""

    def delay(self, attempt: int, base: int, cap: int) -> int: ...


class Fixed:
    def delay(self, attempt: int, base: int, cap: int) -> int:
        return base


class Linear:
    def delay(self, attempt: int, base: int, cap: int) -> int:
        return min(base * attempt, cap)


class Exponential:
    def delay(self, attempt: int, base: int, cap: int) -> int:
        d = min(base, cap)
        for _ in range(attempt - 1):
            d = min(d * 2, cap)
        return d


class Fibonacci:
    def delay(self, attempt: int, base: int, cap: int) -> int:
        previous, current = 0, min(base, cap)
        for _ in range(attempt - 1):
            previous, current = current, min(previous + current, cap)
        return current


KINDS: dict[str, Growth] = {"fixed": Fixed(), "linear": Linear(), "exponential": Exponential()}


def _growth(kind: str) -> Growth:
    if kind not in KINDS:
        raise ValueError("unknown kind")
    return KINDS[kind]


def _count(n: int, low: int) -> None:
    if not low <= n <= MAX_ATTEMPTS:
        raise ValueError("attempts out of range")


class BackoffSchedule:
    """Caps, schedules and totals are the same for every kind; only the growth is swapped."""

    def __init__(self, kind: str, baseMs: int, capMs: int) -> None:
        growth = _growth(kind)
        if not 1 <= baseMs <= capMs <= MAX_CAP_MS:
            raise ValueError("1 <= baseMs <= capMs <= 10^9")
        self._growth = growth
        self._base = baseMs
        self._cap = capMs

    def delay(self, attempt: int) -> int:
        _count(attempt, 1)
        return self._growth.delay(attempt, self._base, self._cap)

    def schedule(self, attempts: int) -> list[int]:
        _count(attempts, 0)
        return [self.delay(a) for a in range(1, attempts + 1)]

    def totalMs(self, attempts: int) -> int:
        return sum(self.schedule(attempts))

    def switchTo(self, kind: str) -> None:
        self._growth = _growth(kind)

    # The extension round: one more growth, and nothing else changes.
    def fibonacci(self) -> None:
        self._growth = Fibonacci()
