from __future__ import annotations

import re

# Lowest precedence first: a later source overrides an earlier one.
SOURCES = ("defaults", "file", "env", "flags")
INTEGER = re.compile(r"-?[0-9]{1,15}")


def parse_int(text: str) -> int:
    """Parsing is its own concern: lookup finds the text, this decides what it means."""
    if INTEGER.fullmatch(text) is None:
        raise ValueError("not an integer")
    return int(text)


class LayeredConfig:
    """Each source's entries are kept as given; only resolution knows the precedence."""

    def __init__(self) -> None:
        self._layers: dict[str, dict[str, str]] = {s: {} for s in SOURCES}
        self._renamed: dict[str, str] = {}  # old key -> new key

    def layer(self, source: str, entries: dict[str, str]) -> None:
        if source not in self._layers:
            raise ValueError("unknown source")
        if "" in entries:
            raise ValueError("a key is not empty")
        self._layers[source] = dict(entries)

    def _names(self, key: str) -> list[str]:
        """The names a setting may be written under, the current one first."""
        if key == "":
            raise ValueError("a key is not empty")
        new = self._renamed.get(key, key)
        return [new, *(old for old, n in self._renamed.items() if n == new)]

    def _winner(self, key: str) -> tuple[str, str] | None:
        names = self._names(key)
        for source in reversed(SOURCES):
            entries = self._layers[source]
            for name in names:
                if name in entries:
                    return source, entries[name]
        return None

    def lookup(self, key: str) -> str | None:
        found = self._winner(key)
        return None if found is None else found[1]

    def origin(self, key: str) -> str | None:
        found = self._winner(key)
        return None if found is None else found[0]

    def intValue(self, key: str) -> int | None:
        found = self._winner(key)
        return None if found is None else parse_int(found[1])

    # The extension round: a renamed setting answers to both names.
    def alias(self, oldKey: str, newKey: str) -> None:
        if oldKey == "" or newKey == "" or oldKey == newKey:
            raise ValueError("two different, non-empty keys")
        used = set(self._renamed) | set(self._renamed.values())
        if oldKey in used or newKey in used:
            raise ValueError("a key is in at most one alias")
        self._renamed[oldKey] = newKey
