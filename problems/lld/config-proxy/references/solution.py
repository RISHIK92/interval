from __future__ import annotations

MAX_TTL_MS = 10**9


class Unavailable(Exception):
    """The upstream didn't answer."""


def _given(value: str) -> None:
    if value == "":
        raise ValueError("empty")


class ConfigService:
    """The slow upstream: it counts every call made to it, and while it's down every call
    fails."""

    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.down = False
        self.calls = 0

    def fetch(self, key: str) -> str | None:
        self.calls += 1
        if self.down:
            raise Unavailable(key)
        return self.values.get(key)


class Entry:
    def __init__(self, value: str, fetchedMs: int) -> None:
        self.value = value
        self.fetchedMs = fetchedMs


class ConfigProxy:
    """Stands in front of the config service with the same job, reading a key, and calls
    through only when its copy is missing or older than the TTL. When the call fails, a
    stale copy is better than nothing."""

    def __init__(self, ttlMs: int) -> None:
        if not 1 <= ttlMs <= MAX_TTL_MS:
            raise ValueError("ttl out of range")
        self._ttl = ttlMs
        self._upstream = ConfigService()
        self._cache: dict[str, Entry] = {}

    def upstreamSet(self, key: str, val: str) -> None:
        _given(key)
        _given(val)
        self._upstream.values[key] = val

    def read(self, key: str, nowMs: int) -> str | None:
        _given(key)
        kept = self._cache.get(key)
        if kept is not None and nowMs - kept.fetchedMs < self._ttl:
            return kept.value
        try:
            value = self._upstream.fetch(key)
        except Unavailable:
            return None if kept is None else kept.value
        if value is not None:
            self._cache[key] = Entry(value, nowMs)
        return value

    def upstreamDown(self, down: bool) -> None:
        self._upstream.down = down

    def upstreamFetches(self) -> int:
        return self._upstream.calls

    # The extension round: dropping a copy before its time.
    def invalidate(self, key: str) -> None:
        _given(key)
        self._cache.pop(key, None)
