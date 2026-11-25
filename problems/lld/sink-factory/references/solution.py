from __future__ import annotations

import re
from abc import ABC, abstractmethod
from collections import deque

FILE = re.compile(r"file:(/[^ ]*)")
SYSLOG = re.compile(r"syslog:([A-Za-z0-9.-]+):([1-9][0-9]{0,4})")
PORT_LIMIT = 65535


def _filled(text: str) -> None:
    if text == "":
        raise ValueError("not empty")


class Sink(ABC):
    """What every product of the factory can do. Callers hold a sink id and never learn
    which class is behind it."""

    kind = ""

    @abstractmethod
    def write(self, line: str) -> str: ...


class StdoutSink(Sink):
    kind = "stdout"

    def write(self, line: str) -> str:
        return line


class FileSink(Sink):
    kind = "file"

    def __init__(self, path: str) -> None:
        self._path = path
        self._written = 0

    def write(self, line: str) -> str:
        self._written += 1
        return f"{self._path}:{self._written} {line}"


class SyslogSink(Sink):
    kind = "syslog"

    def __init__(self, host: str, port: int) -> None:
        self._address = f"{host}:{port}"

    def write(self, line: str) -> str:
        return f"<14>{self._address} {line}"


class BufferedSink(Sink):
    kind = "buffered"

    def __init__(self, capacity: int) -> None:
        self._held: deque[str] = deque(maxlen=capacity)

    def write(self, line: str) -> str:
        self._held.append(line)
        return ""

    def drain(self) -> list[str]:
        out = list(self._held)
        self._held.clear()
        return out


def _parse(spec: str) -> Sink:
    """The creation step, a parameterised factory (the simple form of factory method):
    the spec decides which class to make, and only here."""
    if spec == "stdout":
        return StdoutSink()
    file = FILE.fullmatch(spec)
    if file and not spec.endswith("/"):
        return FileSink(file.group(1))
    syslog = SYSLOG.fullmatch(spec)
    if syslog and int(syslog.group(2)) <= PORT_LIMIT:
        return SyslogSink(syslog.group(1), int(syslog.group(2)))
    raise ValueError("malformed spec")


class SinkFactory:
    def __init__(self) -> None:
        self._sinks: dict[str, Sink] = {}
        self._made: dict[str, int] = {}

    def _keep(self, sink: Sink) -> str:
        number = self._made.get(sink.kind, 0) + 1
        self._made[sink.kind] = number
        sink_id = f"{sink.kind}-{number}"
        self._sinks[sink_id] = sink
        return sink_id

    def _find(self, sink: str) -> Sink:
        found = self._sinks.get(sink)
        if found is None:
            raise KeyError("unknown sink")
        return found

    def create(self, spec: str) -> str:
        return self._keep(_parse(spec))

    def kindOf(self, sink: str) -> str:
        return self._find(sink).kind

    def writeLine(self, sink: str, line: str) -> str:
        found = self._find(sink)
        _filled(line)
        return found.write(line)

    def created(self, kind: str) -> int:
        _filled(kind)
        return self._made.get(kind, 0)

    # The extension round: one more product, made by its own method.
    def createBuffered(self, capacity: int) -> str:
        if not 1 <= capacity <= 1000:
            raise ValueError("capacity is 1 to 1000")
        return self._keep(BufferedSink(capacity))

    def flush(self, sink: str) -> list[str]:
        found = self._find(sink)
        if not isinstance(found, BufferedSink):
            raise ValueError("only a buffered sink holds lines")
        return found.drain()
