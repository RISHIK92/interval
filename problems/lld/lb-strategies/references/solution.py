from __future__ import annotations

from collections import defaultdict
from typing import Protocol

MAX_WEIGHT = 100


class Backend:
    def __init__(self, name: str, weight: int) -> None:
        self.name = name
        self.weight = weight
        self.open = 0
        self.drained = False


class Strategy(Protocol):
    def choose(self, backends: list[Backend]) -> Backend: ...


class RoundRobin:
    """The backend after the one picked last, in the order they were added, wrapping."""

    def __init__(self) -> None:
        self._last = -1

    def choose(self, backends: list[Backend]) -> Backend:
        count = len(backends)
        for step in range(count):
            at = (self._last + 1 + step) % count
            if not backends[at].drained:
                self._last = at
                return backends[at]
        raise ValueError("no backend to pick")


class LeastConnections:
    """The backend with the fewest open connections; a tie goes to the one added
    first."""

    def choose(self, backends: list[Backend]) -> Backend:
        best: Backend | None = None
        for backend in backends:
            if not backend.drained and (best is None or backend.open < best.open):
                best = backend
        if best is None:
            raise ValueError("no backend to pick")
        return best


class SmoothWeighted:
    """Smooth weighted round robin: every pick, each backend's current weight grows by
    its weight, the largest is picked (a tie goes to the one added first), and the pick
    gives back the total, so heavy backends are spread out instead of picked in a
    row."""

    def __init__(self) -> None:
        self._current: defaultdict[str, int] = defaultdict(int)

    def choose(self, backends: list[Backend]) -> Backend:
        best: Backend | None = None
        total = 0
        for backend in backends:
            if backend.drained:
                continue
            total += backend.weight
            self._current[backend.name] += backend.weight
            if best is None or self._current[backend.name] > self._current[best.name]:
                best = backend
        if best is None:
            raise ValueError("no backend to pick")
        self._current[best.name] -= total
        return best


STRATEGIES: dict[str, type[Strategy]] = {
    "round-robin": RoundRobin,
    "least-connections": LeastConnections,
    "weighted-round-robin": SmoothWeighted,
}


class Balancer:
    """Picks a backend for each new connection with a strategy that can be swapped at
    runtime. The balancer owns the backends and their connection counts; a strategy
    owns only its own position, so a new one starts fresh and loses no connections."""

    def __init__(self, strategy: str) -> None:
        self._backends: list[Backend] = []
        self._by_name: dict[str, Backend] = {}
        self._strategy = self._fresh(strategy)

    def addBackend(self, name: str, weight: int) -> None:
        if name == "" or name in self._by_name or not 1 <= weight <= MAX_WEIGHT:
            raise ValueError("bad backend")
        backend = Backend(name, weight)
        self._backends.append(backend)
        self._by_name[name] = backend

    def pick(self) -> str:
        backend = self._strategy.choose(self._backends)
        backend.open += 1
        return backend.name

    def done(self, backend: str) -> None:
        found = self._backend(backend)
        if found.open == 0:
            raise ValueError("no open connection")
        found.open -= 1

    def useStrategy(self, strategy: str) -> None:
        self._strategy = self._fresh(strategy)

    # The extension round: taking a backend out of rotation.
    def drain(self, backend: str) -> None:
        found = self._backend(backend)
        if found.drained:
            raise ValueError("already drained")
        found.drained = True

    def _backend(self, name: str) -> Backend:
        found = self._by_name.get(name)
        if found is None:
            raise ValueError("unknown backend")
        return found

    @staticmethod
    def _fresh(strategy: str) -> Strategy:
        make = STRATEGIES.get(strategy)
        if make is None:
            raise ValueError("unknown strategy")
        return make()
