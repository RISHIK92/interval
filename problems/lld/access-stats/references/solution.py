from __future__ import annotations

from typing import NamedTuple

METHODS = frozenset({"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"})
DIGITS = "0123456789"
MAX_LATENCY = 60_000
MAX_TOP = 100


class Request(NamedTuple):
    path: str
    status: int
    latency: int


def _number(text: str, most: int) -> int | None:
    if not 1 <= len(text) <= most or any(c not in DIGITS for c in text):
        return None
    return int(text)


# Parsing: one line in, one request or nothing out. It knows the format and nothing else.
def parse(line: str) -> Request | None:
    parts = line.split(" ")
    if len(parts) != 4 or parts[0] not in METHODS or not parts[1].startswith("/"):
        return None
    status = _number(parts[2], 3)
    latency = _number(parts[3], 5)
    if status is None or not 100 <= status <= 599 or latency is None or latency > MAX_LATENCY:
        return None
    return Request(parts[1].split("?")[0], status, latency)


# Aggregation: running totals of what was parsed. It never sees a raw line or a report.
class Totals:
    def __init__(self) -> None:
        self.requests = 0
        self.errors = 0
        self.latencies: dict[str, list[int]] = {}
        self.classes: dict[str, int] = {}

    def add(self, request: Request) -> None:
        self.requests += 1
        if request.status >= 500:
            self.errors += 1
        self.latencies.setdefault(request.path, []).append(request.latency)
        status_class = f"{request.status // 100}xx"
        self.classes[status_class] = self.classes.get(status_class, 0) + 1


# Reporting: answers computed from the totals, which it only reads.
def top_paths(totals: Totals, n: int) -> list[str]:
    ranked = sorted(totals.latencies, key=lambda path: (-len(totals.latencies[path]), path))
    return ranked[:n]


def error_rate(totals: Totals) -> float:
    return totals.errors / totals.requests if totals.requests > 0 else 0.0


def median(totals: Totals, path: str) -> int:
    latencies = sorted(totals.latencies[path])
    return latencies[(len(latencies) - 1) // 2]


class AccessStats:
    def __init__(self) -> None:
        self._totals = Totals()

    def ingest(self, line: str) -> bool:
        if line == "":
            raise ValueError("an empty line")
        request = parse(line)
        if request is None:
            return False
        self._totals.add(request)
        return True

    def topPaths(self, n: int) -> list[str]:
        if not 1 <= n <= MAX_TOP:
            raise ValueError("n is 1 to 100")
        return top_paths(self._totals, n)

    def errorRate(self) -> float:
        return error_rate(self._totals)

    def p50(self, path: str) -> int:
        if path not in self._totals.latencies:
            raise KeyError("no requests for that path")
        return median(self._totals, path)

    # The extension round.
    def byStatusClass(self) -> dict[str, int]:
        return dict(self._totals.classes)
