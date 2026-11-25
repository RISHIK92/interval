from __future__ import annotations

from typing import Protocol

FAILURE = 500  # a status of at least this is a failure
BACKOFF_MS = 100  # the wait before the first retry; it doubles for each one after
OPEN_MS = 1000  # how long a breaker stays open


class Script:
    """One path's scripted answers: in order, then the last one again and again."""

    def __init__(self, statuses: list[int], latencies: list[int]) -> None:
        self.answers = [(statuses[i], latencies[i]) for i in range(len(statuses))]
        self.served = 0

    def next(self) -> tuple[int, int]:
        answer = self.answers[min(self.served, len(self.answers) - 1)]
        self.served += 1
        return answer


class Layer(Protocol):
    """Every layer, and the transport at the bottom, has the same call: a request for a
    path that starts at time t returns its status and how long it took. A layer wraps
    the one below it and never knows what that is."""

    def call(self, path: str, t: int) -> tuple[int, int]: ...


class Transport:
    def __init__(self) -> None:
        self.scripts: dict[str, Script] = {}
        self.calls = 0

    def call(self, path: str, t: int) -> tuple[int, int]:
        self.calls += 1
        return self.scripts[path].next()


class Retry:
    def __init__(self, inner: Layer, retries: int) -> None:
        self.inner = inner
        self.retries = retries

    def call(self, path: str, t: int) -> tuple[int, int]:
        spent = 0
        for attempt in range(self.retries + 1):
            if attempt > 0:
                spent += BACKOFF_MS * 2 ** (attempt - 1)
            status, took = self.inner.call(path, t + spent)
            spent += took
            if status < FAILURE:
                break
        return status, spent


class Cache:
    def __init__(self, inner: Layer, ttl: int) -> None:
        self.inner = inner
        self.ttl = ttl
        self.stored: dict[str, int] = {}  # path -> when its 200 arrived

    def call(self, path: str, t: int) -> tuple[int, int]:
        at = self.stored.get(path)
        if at is not None and at <= t < at + self.ttl:
            return 200, 0
        status, took = self.inner.call(path, t)
        if status == 200:
            self.stored[path] = t + took
        return status, took


class Breaker:
    def __init__(self, inner: Layer, threshold: int) -> None:
        self.inner = inner
        self.threshold = threshold
        self.failures = 0
        self.opened: int | None = None

    def call(self, path: str, t: int) -> tuple[int, int]:
        if self.opened is not None and self.opened <= t < self.opened + OPEN_MS:
            return 503, 0
        status, took = self.inner.call(path, t)
        if status < FAILURE:
            self.failures = 0
            return status, took
        self.failures += 1
        if self.failures >= self.threshold:
            self.opened = t + took
            # It stays at the threshold, so after the cooldown one more failure
            # reopens it straight away; a success only resets the count, and an
            # open window runs out on its own.
            self.failures = self.threshold
        return status, took


class Hedge:
    def __init__(self, inner: Layer, after: int) -> None:
        self.inner = inner
        self.after = after

    def call(self, path: str, t: int) -> tuple[int, int]:
        status, took = self.inner.call(path, t)
        if took <= self.after:
            return status, took
        second, second_took = self.inner.call(path, t + self.after)
        if self.after + second_took < took:
            return second, self.after + second_took
        return status, took


LAYERS = {"retry": Retry, "cache": Cache, "breaker": Breaker}


class ClientStack:
    """A decorator stack over a scripted transport: each wrap puts a layer outside the
    ones already there, so the order of the wraps decides what each layer sees."""

    def __init__(self) -> None:
        self._transport = Transport()
        self._top: Layer = self._transport
        self._elapsed = 0

    def script(self, path: str, statuses: list[int], latenciesMs: list[int]) -> None:
        if path == "" or not statuses or len(statuses) != len(latenciesMs):
            raise ValueError("a path and one latency per status")
        for status in statuses:
            if status < 100 or status > 599:
                raise ValueError("not an HTTP status")
        for latency in latenciesMs:
            if latency < 0:
                raise ValueError("a negative latency")
        self._transport.scripts[path] = Script(statuses, latenciesMs)

    def wrap(self, layer: str, param: int) -> None:
        if layer not in LAYERS:
            raise ValueError("unknown layer")
        if param < 1 or (layer == "retry" and param > 5):
            raise ValueError("a parameter out of range")
        self._top = LAYERS[layer](self._top, param)

    def fetch(self, path: str, nowMs: int) -> int:
        if path not in self._transport.scripts:
            raise KeyError("an unscripted path")
        status, self._elapsed = self._top.call(path, nowMs)
        return status

    def upstreamCalls(self) -> int:
        return self._transport.calls

    def elapsedMs(self) -> int:
        return self._elapsed

    # The extension round: one more layer, which only needs the same call as the rest.
    def hedge(self, afterMs: int) -> None:
        if afterMs < 0:
            raise ValueError("a negative delay")
        self._top = Hedge(self._top, afterMs)
