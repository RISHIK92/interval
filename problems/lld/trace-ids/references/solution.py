from __future__ import annotations

MAX_NODE = 1023
MAX_MS = 1_000_000_000_000
PER_MS = 1000  # sequences 000 to 999 in one millisecond
WIDTHS = [13, 4, 3]  # timestamp, node, sequence


def _digits(text: str) -> bool:
    return all(c in "0123456789" for c in text)


class TraceIds:
    """The process's one ID source. Every caller shares this instance, so the last timestamp
    and its sequence live here and nowhere else: two sources on one node could issue the
    same ID, which is why there is only ever one."""

    def __init__(self, nodeId: int) -> None:
        if not 0 <= nodeId <= MAX_NODE:
            raise ValueError("node out of range")
        self._node = nodeId
        self._ms = -1
        self._sequence: int  # set by the first ID: any time beats -1
        self._issued = 0

    def nextId(self, nowMs: int) -> str:
        if not 0 <= nowMs <= MAX_MS:
            raise ValueError("time out of range")
        if nowMs > self._ms:
            self._ms = nowMs
            self._sequence = 0
        elif self._sequence + 1 < PER_MS:
            # The same millisecond, or a clock that went backwards: stay on the last one.
            self._sequence += 1
        else:
            # A full millisecond borrows the next one, so IDs keep sorting in issue order.
            self._ms += 1
            self._sequence = 0
        self._issued += 1
        return f"{self._ms:013d}-{self._node:04d}-{self._sequence:03d}"

    def issued(self) -> int:
        return self._issued

    def lastMs(self) -> int:
        return self._ms

    # The extension round: reading an ID back.
    def decode(self, traceId: str) -> list[int]:
        parts = traceId.split("-")
        if [len(p) for p in parts] != WIDTHS or not all(_digits(p) for p in parts):
            raise ValueError("not a trace ID")
        values = [int(p) for p in parts]
        if values[1] > MAX_NODE:
            raise ValueError("node out of range")
        return values
