from __future__ import annotations

import re
from abc import ABC, abstractmethod

_WORD = re.compile(r"[a-z0-9]+")
_TERM = re.compile(r"[A-Za-z0-9]+")


def _terms(text: str) -> set[str]:
    return set(_WORD.findall(text.lower()))


class SearchIndex(ABC):
    """What callers see: the real index and its proxy answer the same calls."""

    @abstractmethod
    def addDoc(self, id: str, text: str) -> None: ...

    @abstractmethod
    def search(self, term: str) -> list[str]: ...

    @abstractmethod
    def removeDoc(self, id: str) -> bool: ...


class InvertedIndex(SearchIndex):
    """The real subject: each term maps to the documents that contain it. Building it
    reads every document, which is the work the proxy puts off."""

    def __init__(self, docs: dict[str, str]) -> None:
        self._postings: dict[str, set[str]] = {}
        self._docs: dict[str, set[str]] = {}
        for doc_id, text in docs.items():
            self.addDoc(doc_id, text)

    def addDoc(self, id: str, text: str) -> None:
        self.removeDoc(id)
        terms = _terms(text)
        self._docs[id] = terms
        for term in terms:
            self._postings.setdefault(term, set()).add(id)

    def search(self, term: str) -> list[str]:
        return sorted(self._postings.get(term.lower(), set()))

    def removeDoc(self, id: str) -> bool:
        terms = self._docs.pop(id, None)
        if terms is None:
            return False
        for term in terms:
            self._postings[term].discard(id)
        return True

    def size(self) -> int:
        return len(self._docs)


class LazyIndex(SearchIndex):
    """A virtual proxy: it answers like the index, but holds only the raw documents
    until the first search needs the real one. After that, every change goes straight
    to the real index, one document at a time, so it's never built twice."""

    def __init__(self) -> None:
        self._pending: dict[str, str] = {}
        self._index: InvertedIndex | None = None
        self._builds = 0

    def _real(self) -> InvertedIndex:
        if self._index is None:
            self._index = InvertedIndex(self._pending)
            self._builds += 1
        return self._index

    def addDoc(self, id: str, text: str) -> None:
        if id == "" or text == "":
            raise ValueError("empty")
        if self._index is None:
            self._pending[id] = text
        else:
            self._index.addDoc(id, text)

    def search(self, term: str) -> list[str]:
        if not _TERM.fullmatch(term):
            raise ValueError("a term is letters and digits")
        return self._real().search(term)

    def builds(self) -> int:
        return self._builds

    def indexed(self) -> int:
        return 0 if self._index is None else self._index.size()

    # The extension round: documents leave without a rebuild either.
    def removeDoc(self, id: str) -> bool:
        if id == "":
            raise ValueError("empty")
        if self._index is None:
            return self._pending.pop(id, None) is not None
        return self._index.removeDoc(id)
