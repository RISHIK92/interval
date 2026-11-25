from __future__ import annotations

# The legacy agent's units, each as the new API's kind and how many base units it is.
TIME_UNITS = {"s": 1000.0, "ms": 1.0, "us": 0.001}
SIZE_UNITS = {"B": 1, "KB": 1024, "MB": 1024 * 1024}


class MetricsApi:
    """The new metrics API: it knows only milliseconds and bytes, and each name is one
    or the other."""

    def __init__(self) -> None:
        self._ms: dict[str, float] = {}
        self._bytes: dict[str, int] = {}

    def recordMs(self, name: str, ms: float) -> bool:
        if name in self._bytes:
            return False
        self._ms[name] = ms
        return True

    def recordBytes(self, name: str, size: int) -> bool:
        if name in self._ms:
            return False
        self._bytes[name] = size
        return True

    def ms(self, name: str) -> float | None:
        return self._ms.get(name)

    def size(self, name: str) -> int | None:
        return self._bytes.get(name)

    def names(self) -> list[str]:
        return sorted([*self._ms, *self._bytes])


def _number(text: str) -> int | None:
    if not 1 <= len(text) <= 9 or any(c not in "0123456789" for c in text):
        return None
    return int(text)


class MetricsAdapter:
    """Speaks the legacy agent's `name value unit` lines and feeds the new API: the only
    code that knows the old format and units."""

    def __init__(self) -> None:
        self._api = MetricsApi()

    def ingestLegacy(self, line: str) -> bool:
        if line == "":
            raise ValueError("empty line")
        return self._ingest(line)

    def gaugeMs(self, name: str) -> float | None:
        _named(name)
        return self._api.ms(name)

    def gaugeBytes(self, name: str) -> int | None:
        _named(name)
        return self._api.size(name)

    def names(self) -> list[str]:
        return self._api.names()

    # The extension round: a batch of lines, each as ingestLegacy takes it.
    def ingestBatch(self, lines: list[str]) -> int:
        return sum(1 for line in lines if self._ingest(line))

    def _ingest(self, line: str) -> bool:
        fields = line.split(" ")
        if len(fields) != 3 or fields[0] == "":
            return False
        name, text, unit = fields
        value = _number(text)
        if value is None:
            return False
        if unit in TIME_UNITS:
            return self._api.recordMs(name, value * TIME_UNITS[unit])
        if unit in SIZE_UNITS:
            return self._api.recordBytes(name, value * SIZE_UNITS[unit])
        return False


def _named(name: str) -> None:
    if name == "":
        raise ValueError("empty name")
