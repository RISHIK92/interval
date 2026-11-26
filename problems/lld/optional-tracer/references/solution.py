from __future__ import annotations

from typing import Protocol

MAX_SAMPLE_EVERY = 1000


class Trace(Protocol):
    def span(self, name: str) -> int: ...

    def endSpan(self, spanId: int) -> bool: ...

    def recorded(self) -> list[str]: ...

    def sampled(self) -> Trace: ...


class RecordingTrace:
    """A sampled trace: spans get ids from 1, and each one is recorded when it ends."""

    def __init__(self) -> None:
        self._open: dict[int, str] = {}
        self._started = 0
        self._recorded: list[str] = []

    def span(self, name: str) -> int:
        self._started += 1
        self._open[self._started] = name
        return self._started

    def endSpan(self, spanId: int) -> bool:
        name = self._open.pop(spanId, None)
        if name is not None:
            self._recorded.append(f"{spanId} {name}")
        return name is not None

    def recorded(self) -> list[str]:
        return list(self._recorded)

    def sampled(self) -> Trace:
        return self


class NoopTrace:
    """The null object: the same methods as a recording trace, and they never refuse and
    record nothing, so callers never check whether a trace is sampled."""

    def span(self, name: str) -> int:
        return 0

    def endSpan(self, spanId: int) -> bool:
        return True

    def recorded(self) -> list[str]:
        return []

    def sampled(self) -> Trace:
        return RecordingTrace()


class Tracer:
    """Samples one trace in every sampleEvery. The tracer checks arguments the same way
    for every trace, then hands the call to the trace, recording or not."""

    def __init__(self, sampleEvery: int) -> None:
        if not 1 <= sampleEvery <= MAX_SAMPLE_EVERY:
            raise ValueError("bad sampling rate")
        self._every = sampleEvery
        self._traces: dict[str, Trace] = {}

    def startTrace(self, name: str) -> str:
        _given(name)
        sampled = len(self._traces) % self._every == 0
        trace = f"{name}#{len(self._traces) + 1}"
        self._traces[trace] = RecordingTrace() if sampled else NoopTrace()
        return trace

    def span(self, trace: str, name: str) -> int:
        found = self._trace(trace)
        _given(name)
        return found.span(name)

    def endSpan(self, trace: str, spanId: int) -> bool:
        return self._trace(trace).endSpan(spanId)

    def recorded(self, trace: str) -> list[str]:
        return self._trace(trace).recorded()

    # The extension round: sampling a trace that wasn't.
    def forceSample(self, trace: str) -> None:
        self._traces[trace] = self._trace(trace).sampled()

    def _trace(self, trace: str) -> Trace:
        found = self._traces.get(trace)
        if found is None:
            raise ValueError("unknown trace")
        return found


def _given(value: str) -> None:
    if value == "":
        raise ValueError("empty name")
