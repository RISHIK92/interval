from __future__ import annotations

from typing import NamedTuple


class Symbol(NamedTuple):
    """The flyweight: one immutable record per distinct text, shared by every occurrence."""

    id: int
    text: str


class Interner:
    """The flyweight factory: hands out the one shared symbol for a text, making it only
    the first time the text is seen."""

    def __init__(self) -> None:
        self._by_text: dict[str, Symbol] = {}
        self._by_id: dict[int, Symbol] = {}
        self._saved = 0

    def intern(self, text: str) -> int:
        if text == "":
            raise ValueError("empty text")
        shared = self._by_text.get(text)
        if shared is not None:
            self._saved += len(text)
            return shared.id
        symbol = Symbol(len(self._by_id), text)
        self._by_text[text] = symbol
        self._by_id[symbol.id] = symbol
        return symbol.id

    def lookup(self, id: int) -> str:
        symbol = self._by_id.get(id)
        if symbol is None:
            raise ValueError("unknown id")
        return symbol.text

    def size(self) -> int:
        return len(self._by_id)

    def bytesSaved(self) -> int:
        return self._saved
