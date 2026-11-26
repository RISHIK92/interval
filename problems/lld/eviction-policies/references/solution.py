from __future__ import annotations

from itertools import count


class Entry:
    """A cached value and its usage history: the moment of every use, the first being
    its arrival. Every policy reads the same history, so switching never loses it."""

    def __init__(self, value: int, stamp: int) -> None:
        self.value = value
        self.stamps = [stamp]


class Lru:
    def rank(self, entry: Entry) -> tuple[int, ...]:
        return (entry.stamps[-1],)


class Lfu:
    def rank(self, entry: Entry) -> tuple[int, ...]:
        return (len(entry.stamps), entry.stamps[-1])


class Fifo:
    def rank(self, entry: Entry) -> tuple[int, ...]:
        return (entry.stamps[0],)


# Each strategy only ranks entries; the lowest rank is evicted.
POLICIES: dict[str, Lru | Lfu | Fifo] = {"lru": Lru(), "lfu": Lfu(), "fifo": Fifo()}


class EvictingCache:
    def __init__(self, capacity: int, policy: str) -> None:
        if capacity < 1 or policy not in POLICIES:
            raise ValueError("bad capacity or policy")
        self._capacity = capacity
        self._policy = POLICIES[policy]
        self._entries: dict[str, Entry] = {}
        self._pinned: set[str] = set()
        self._clock = count()

    def _use(self, entry: Entry) -> None:
        entry.stamps.append(next(self._clock))

    def _evict(self) -> None:
        candidates = [key for key in self._entries if key not in self._pinned]
        if not candidates:
            raise ValueError("every key is pinned")
        victim = min(candidates, key=lambda key: self._policy.rank(self._entries[key]))
        del self._entries[victim]

    def put(self, key: str, val: int) -> None:
        if key == "":
            raise ValueError("an empty key")
        entry = self._entries.get(key)
        if entry is None:
            if len(self._entries) >= self._capacity:
                self._evict()
            self._entries[key] = Entry(val, next(self._clock))
        else:
            entry.value = val
            self._use(entry)

    def lookup(self, key: str) -> int | None:
        if key == "":
            raise ValueError("an empty key")
        entry = self._entries.get(key)
        if entry is None:
            return None
        self._use(entry)
        return entry.value

    def keys(self) -> list[str]:
        return sorted(self._entries)

    def switchPolicy(self, policy: str) -> None:
        if policy not in POLICIES:
            raise ValueError("unknown policy")
        self._policy = POLICIES[policy]

    # The extension round: a pinned key is passed over by every policy.
    def pinKey(self, key: str) -> None:
        if key not in self._entries:
            raise KeyError("not cached")
        self._pinned.add(key)
