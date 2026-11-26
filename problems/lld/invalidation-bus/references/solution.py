from __future__ import annotations


class AppNode:
    """A subscriber: it keeps a local cache and drops a key when it hears it changed."""

    def __init__(self) -> None:
        self.cache: dict[str, str] = {}
        # The bus version when it went offline, or None while it is online.
        self.down_at: int | None = None
        self.prefixes: list[str] = []  # none means it hears every key

    def hears(self, key: str) -> bool:
        return not self.prefixes or any(key.startswith(p) for p in self.prefixes)

    def invalidate(self, key: str) -> None:
        self.cache.pop(key, None)


class InvalidationBus:
    """The publisher: every write is numbered and announced to the nodes online."""

    def __init__(self) -> None:
        self._nodes: dict[str, AppNode] = {}
        self._log: list[str] = []  # the key of each write, version 1 first

    def join(self, node: str) -> None:
        if node == "" or node in self._nodes:
            raise ValueError("empty or joined")
        self._nodes[node] = AppNode()

    def cacheLocal(self, node: str, key: str, val: str) -> None:
        n = self._serving(node)
        if key == "" or val == "" or not n.hears(key):
            raise ValueError("empty or outside the keyspace")
        n.cache[key] = val

    def write(self, key: str) -> int:
        if key == "":
            raise ValueError("empty key")
        self._log.append(key)
        # A node never caches a key outside its keyspace, so dropping it there is moot.
        for n in self._nodes.values():
            if n.down_at is None:
                n.invalidate(key)
        return len(self._log)

    def cached(self, node: str, key: str) -> str | None:
        n = self._serving(node)
        if key == "":
            raise ValueError("empty key")
        return n.cache.get(key)

    def offline(self, node: str, down: bool) -> None:
        n = self._node(node)
        if n.down_at is None:
            if down:
                n.down_at = len(self._log)
            return
        if down:
            return
        if any(n.hears(key) for key in self._log[n.down_at :]):
            # It can't know which keys changed while it was away, only that some did.
            n.cache.clear()
        n.down_at = None

    # The extension round: a node hears only the keys under its prefixes.
    def keyspace(self, node: str, prefix: str) -> int:
        n = self._node(node)
        if prefix == "":
            raise ValueError("empty prefix")
        if prefix not in n.prefixes:
            n.prefixes.append(prefix)
        outside = [key for key in n.cache if not n.hears(key)]
        for key in outside:
            del n.cache[key]
        return len(outside)

    def _node(self, node: str) -> AppNode:
        if node not in self._nodes:
            raise ValueError("unknown node")
        return self._nodes[node]

    def _serving(self, node: str) -> AppNode:
        n = self._node(node)
        if n.down_at is not None:
            raise ValueError("the node is offline")
        return n
