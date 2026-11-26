from __future__ import annotations

EARLIEST = 0


class Stream:
    def __init__(self, name: str) -> None:
        self.name = name
        self.lines: list[tuple[int, str]] = []
        self.head = 0  # the first line not yet returned or passed


class LogMerger:
    """An iterator over many time-ordered streams at once. Its position is the
    (time, stream) of the last line it returned or skipped to; each stream keeps its own
    head, so lines added later slot in without rebuilding anything."""

    def __init__(self) -> None:
        self._streams: dict[str, Stream] = {}
        self._hidden: set[str] = set()
        self._at: tuple[int, str] = (EARLIEST, "")

    def _first(self, stream: Stream) -> tuple[int, str] | None:
        """The stream's first line at or after the position. Lines behind it (skipped,
        or passed while the stream was hidden) are dropped for good."""
        for i in range(stream.head, len(stream.lines)):
            if (stream.lines[i][0], stream.name) >= self._at:
                stream.head = i
                return stream.lines[i]
        stream.head = len(stream.lines)
        return None

    def _visible(self) -> list[Stream]:
        return [s for name, s in sorted(self._streams.items()) if name not in self._hidden]

    def _peek(self) -> Stream | None:
        best: Stream | None = None
        for stream in self._visible():
            line = self._first(stream)
            if line is not None and (best is None or line[0] < best.lines[best.head][0]):
                best = stream
        return best

    def addLine(self, stream: str, ts: int, line: str) -> bool:
        if stream == "" or line == "" or ts < EARLIEST:
            raise ValueError("an empty name or line, or a negative time")
        found = self._streams.get(stream)
        if (found is not None and ts < found.lines[-1][0]) or (ts, stream) < self._at:
            return False
        if found is None:
            found = self._streams[stream] = Stream(stream)
        found.lines.append((ts, line))
        return True

    def hasNext(self) -> bool:
        return self._peek() is not None

    def next(self) -> str:
        stream = self._peek()
        if stream is None:
            raise IndexError("no more lines")
        ts, line = stream.lines[stream.head]
        stream.head += 1
        self._at = (ts, stream.name)
        return f"{ts} {stream.name} {line}"

    def skipUntil(self, ts: int) -> int:
        if ts < EARLIEST:
            raise ValueError("a negative time")
        skipped = 0
        for stream in self._visible():
            if self._first(stream) is not None:
                skipped += sum(1 for at, _ in stream.lines[stream.head :] if at < ts)
        # Moving the position is the skip: every line behind it is dropped when reached.
        self._at = max(self._at, (ts, ""))
        return skipped

    # The extension round: a hidden stream is passed over, not held back.
    def filterStream(self, stream: str, on: bool) -> None:
        if stream == "":
            raise ValueError("an empty stream")
        if on:
            self._hidden.add(stream)
        else:
            self._hidden.discard(stream)
