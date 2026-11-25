from __future__ import annotations

import re
from abc import ABC, abstractmethod

ACCESS = re.compile(r'([^ ]+) ([^ ]+) ([^ ]+) \[([^\]]+)\] "([^ "]+) ([^ "]+) ([^ "]+)" ([0-9]{3}) ([0-9]+|-)')
ACCESS_KEYS = ("host", "ident", "user", "time", "method", "path", "protocol", "status", "bytes")


class Format(ABC):
    """One named way to read a line. Each kind reads it its own way."""

    def __init__(self) -> None:
        self.count = 0

    @abstractmethod
    def fields(self, line: str) -> dict[str, str] | None:
        """The line's fields, or None when it's malformed for this kind."""


class KeyValueFormat(Format):
    def fields(self, line: str) -> dict[str, str] | None:
        out: dict[str, str] = {}
        for token in line.split(" "):
            key, equals, value = token.partition("=")
            if key == "" or equals == "" or key in out:
                return None
            out[key] = value
        return out


class CsvFormat(Format):
    def __init__(self, headers: list[str]) -> None:
        super().__init__()
        self.headers = list(headers)

    def fields(self, line: str) -> dict[str, str] | None:
        values = line.split(",")
        if len(values) != len(self.headers):
            return None
        return dict(zip(self.headers, values))


class AccessFormat(Format):
    def fields(self, line: str) -> dict[str, str] | None:
        match = ACCESS.fullmatch(line)
        if match is None:
            return None
        return dict(zip(ACCESS_KEYS, match.groups()))


class LogParser:
    def __init__(self) -> None:
        self._formats: dict[str, Format] = {}

    def _format(self, name: str) -> Format:
        if name not in self._formats:
            raise KeyError("no such format")
        return self._formats[name]

    def addFormat(self, name: str, kind: str, headers: list[str]) -> None:
        if name == "" or name in self._formats:
            raise ValueError("a format needs a new, non-empty name")
        if kind == "csv":
            if not 1 <= len(headers) <= 20 or "" in headers or len(set(headers)) != len(headers):
                raise ValueError("1-20 distinct, non-empty headers")
            self._formats[name] = CsvFormat(headers)
        elif kind == "kv" and not headers:
            self._formats[name] = KeyValueFormat()
        elif kind == "access" and not headers:
            self._formats[name] = AccessFormat()
        else:
            raise ValueError("unknown kind, or headers where none are taken")

    def parse(self, format: str, line: str) -> dict[str, str]:
        chosen = self._format(format)
        fields = chosen.fields(line)
        if fields is None:
            raise ValueError("malformed line")
        chosen.count += 1
        return fields

    def parsed(self, format: str) -> int:
        return self._format(format).count

    # The extension round.
    def detect(self, line: str) -> str | None:
        for name, candidate in self._formats.items():
            if candidate.fields(line) is not None:
                return name
        return None
