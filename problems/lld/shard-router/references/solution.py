from __future__ import annotations

from abc import ABC, abstractmethod

MOST_SHARDS = 1000
MODULUS = 1_000_000_007
FIRST_PRINTABLE = 32
PRINTABLE = 95


class Strategy(ABC):
    """How a key finds its shard; None when this strategy has no shard for it."""

    @abstractmethod
    def shard(self, key: str, shards: int) -> int | None: ...


class HashModulo(Strategy):
    def shard(self, key: str, shards: int) -> int | None:
        h = 0
        for c in key:
            h = (h * 31 + ord(c)) % MODULUS
        return h % shards


class KeyRange(Strategy):
    def shard(self, key: str, shards: int) -> int | None:
        # Printable ASCII split into equal ranges by the first character.
        return (ord(key[0]) - FIRST_PRINTABLE) * shards // PRINTABLE


class Directory(Strategy):
    def __init__(self, entries: dict[str, int]) -> None:
        self.entries = entries

    def shard(self, key: str, shards: int) -> int | None:
        return self.entries.get(key)


class ShardRouter:
    def __init__(self, shards: int, strategy: str) -> None:
        _count(shards)
        self._shards = shards
        self._directory: dict[str, int] = {}
        self._strategies: dict[str, Strategy] = {
            "hash": HashModulo(),
            "range": KeyRange(),
            "directory": Directory(self._directory),
        }
        self._strategy = self._pick(strategy)
        self._tracked: set[str] = set()

    def route(self, key: str) -> int:
        shard = self._strategy.shard(_key(key), self._shards)
        if shard is None:
            raise ValueError("no directory entry")
        return shard

    def track(self, key: str) -> None:
        self._tracked.add(_key(key))

    def assignDirectory(self, key: str, shard: int) -> None:
        _key(key)
        if shard < 0 or shard >= self._shards:
            raise ValueError("no such shard")
        self._directory[key] = shard

    def rebalance(self, shards: int) -> int:
        _count(shards)
        before = self._placement()
        self._shards = shards
        for key, at in self._directory.items():
            self._directory[key] = at % shards
        return self._moved(before)

    # The extension round: switching strategy, reporting what moves.
    def useStrategy(self, strategy: str) -> int:
        chosen = self._pick(strategy)
        before = self._placement()
        self._strategy = chosen
        return self._moved(before)

    def _pick(self, strategy: str) -> Strategy:
        if strategy not in self._strategies:
            raise ValueError("unknown strategy")
        return self._strategies[strategy]

    def _placement(self) -> dict[str, int | None]:
        return {key: self._strategy.shard(key, self._shards) for key in self._tracked}

    def _moved(self, before: dict[str, int | None]) -> int:
        after = self._placement()
        return sum(1 for key in self._tracked if before[key] != after[key])


def _count(shards: int) -> None:
    if shards < 1 or shards > MOST_SHARDS:
        raise ValueError("shards out of range")


def _key(key: str) -> str:
    if key == "":
        raise ValueError("empty key")
    return key
