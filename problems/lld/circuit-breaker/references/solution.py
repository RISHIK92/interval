from __future__ import annotations

MAX_THRESHOLD = 1000
MAX_COOL_DOWN_MS = 10**9


class State:
    """One state's rules. Each event returns the state the breaker is in afterwards, so
    the breaker itself never asks which state it's in."""

    name = ""

    def tick(self, breaker: CircuitBreaker, nowMs: int) -> State:
        return self

    def allow(self) -> bool:
        return False

    def success(self, breaker: CircuitBreaker, nowMs: int) -> State:
        return self

    def failure(self, breaker: CircuitBreaker, nowMs: int) -> State:
        return self

    def force(self, on: bool) -> State:
        return ForcedOpen() if on else self


class Closed(State):
    name = "closed"

    def __init__(self) -> None:
        self.failures = 0

    def allow(self) -> bool:
        return True

    def success(self, breaker: CircuitBreaker, nowMs: int) -> State:
        self.failures = 0
        return self

    def failure(self, breaker: CircuitBreaker, nowMs: int) -> State:
        self.failures += 1
        if self.failures >= breaker.threshold:
            return Open(nowMs)
        return self


class Open(State):
    """Refuses every call until the cool-down has passed; outcomes of calls let through
    earlier change nothing."""

    name = "open"

    def __init__(self, openedMs: int) -> None:
        self.openedMs = openedMs

    def tick(self, breaker: CircuitBreaker, nowMs: int) -> State:
        if nowMs >= self.openedMs + breaker.coolDownMs:
            return HalfOpen()
        return self


class HalfOpen(State):
    """Lets one trial call through; only that call's outcome decides what comes next."""

    name = "half-open"

    def __init__(self) -> None:
        self.trial = False

    def allow(self) -> bool:
        allowed = not self.trial
        self.trial = True
        return allowed

    def success(self, breaker: CircuitBreaker, nowMs: int) -> State:
        return Closed() if self.trial else self

    def failure(self, breaker: CircuitBreaker, nowMs: int) -> State:
        return Open(nowMs) if self.trial else self


class ForcedOpen(State):
    """The manual override: open, with no cool-down, until it's released."""

    name = "open"

    def force(self, on: bool) -> State:
        return self if on else Closed()


class CircuitBreaker:
    """Guards calls to a failing dependency. The breaker checks the time and hands every
    event to its current state object, which says what happens and what comes next."""

    def __init__(self, threshold: int, coolDownMs: int) -> None:
        if (
            not 1 <= threshold <= MAX_THRESHOLD
            or not 1 <= coolDownMs <= MAX_COOL_DOWN_MS
        ):
            raise ValueError("bad threshold or cool-down")
        self.threshold = threshold
        self.coolDownMs = coolDownMs
        self._state: State = Closed()
        self._lastMs = 0

    def allow(self, nowMs: int) -> bool:
        return self._at(nowMs).allow()

    def success(self, nowMs: int) -> None:
        self._state = self._at(nowMs).success(self, nowMs)

    def failure(self, nowMs: int) -> None:
        self._state = self._at(nowMs).failure(self, nowMs)

    def state(self, nowMs: int) -> str:
        return self._at(nowMs).name

    # The extension round: the manual override.
    def forceOpen(self, on: bool) -> None:
        self._state = self._state.force(on)

    def _at(self, nowMs: int) -> State:
        if nowMs < self._lastMs:
            raise ValueError("time went backwards")
        self._lastMs = nowMs
        self._state = self._state.tick(self, nowMs)
        return self._state
