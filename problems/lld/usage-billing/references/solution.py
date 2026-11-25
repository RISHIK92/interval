from __future__ import annotations

from abc import ABC, abstractmethod

MAX_UNITS = 10**9
MAX_MINIMUM_CENTS = 10**9
MAX_RATE = 10**6
MAX_TIERS = 10


def _tiers(tiers: list[list[int]]) -> list[tuple[int, int]]:
    if len(tiers) > MAX_TIERS or not tiers or any(len(t) != 2 for t in tiers):
        raise ValueError("1-10 tiers, each [start, centsPerUnit]")
    starts = [t[0] for t in tiers]
    if starts[0] != 0 or any(a >= b for a, b in zip(starts, starts[1:])) or starts[-1] > MAX_UNITS:
        raise ValueError("starts begin at 0 and rise, up to 10^9")
    if any(not 0 <= t[1] <= MAX_RATE for t in tiers):
        raise ValueError("rates within 0-10^6")
    return [(t[0], t[1]) for t in tiers]


class Pricing(ABC):
    """How a metric turns a customer's units into cents."""

    def __init__(self, tiers: list[tuple[int, int]]) -> None:
        self.tiers = tiers

    @abstractmethod
    def charge(self, units: int) -> int: ...


class Graduated(Pricing):
    def charge(self, units: int) -> int:
        total = 0
        for start, rate in reversed(self.tiers):
            above = max(units - start, 0)
            total += above * rate
            units -= above
        return total


class Volume(Pricing):
    def charge(self, units: int) -> int:
        rate = next(r for s, r in reversed(self.tiers) if s < units)
        return units * rate


MODELS: dict[str, type[Pricing]] = {"graduated": Graduated, "volume": Volume}


class UsageBilling:
    def __init__(self) -> None:
        self._pricing: dict[str, Pricing] = {}
        self._minimums: dict[str, int] = {}
        self._usage: dict[str, dict[str, int]] = {}

    def price(self, metric: str, model: str, tiers: list[list[int]]) -> None:
        if metric == "" or model not in MODELS:
            raise ValueError("a named metric and a known model")
        self._pricing[metric] = MODELS[model](_tiers(tiers))

    def meter(self, customer: str, metric: str, units: int) -> None:
        if customer == "" or metric not in self._pricing or not 1 <= units <= MAX_UNITS:
            raise ValueError("a customer, a priced metric and 1-10^9 units")
        used = self._usage.setdefault(customer, {})
        used[metric] = used.get(metric, 0) + units

    def _line(self, metric: str, units: int) -> int:
        charge = self._pricing[metric].charge(units)
        if metric in self._minimums:
            charge = max(charge, self._minimums[metric])
        return charge

    def invoice(self, customer: str) -> dict[str, int]:
        return {metric: self._line(metric, units) for metric, units in self._usage.get(customer, {}).items()}

    def total(self, customer: str) -> int:
        return sum(self.invoice(customer).values())

    # The extension round.
    def minimum(self, metric: str, cents: int) -> None:
        if metric not in self._pricing or not 0 <= cents <= MAX_MINIMUM_CENTS:
            raise ValueError("a priced metric and 0-10^9 cents")
        self._minimums[metric] = cents
