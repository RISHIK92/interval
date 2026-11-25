from __future__ import annotations

from collections.abc import Iterable
from typing import Protocol


class Backend(Protocol):
    """What the store needs from where blobs are kept. Callers only see BlobStore, so
    which backend is behind it never shows in their code."""

    def put(self, key: str, data: str) -> int: ...

    def latest(self, key: str) -> str | None: ...

    def version(self, key: str, version: int) -> str | None: ...

    def remove(self, key: str) -> bool: ...

    def keys(self) -> Iterable[str]: ...


class Plain:
    """Keeps only the latest blob of each key, and counts the puts to number it."""

    def __init__(self) -> None:
        self._blobs: dict[str, tuple[int, str]] = {}

    def put(self, key: str, data: str) -> int:
        number = self._blobs[key][0] + 1 if key in self._blobs else 1
        self._blobs[key] = (number, data)
        return number

    def latest(self, key: str) -> str | None:
        found = self._blobs.get(key)
        return None if found is None else found[1]

    def version(self, key: str, version: int) -> str | None:
        found = self._blobs.get(key)
        return found[1] if found is not None and found[0] == version else None

    def remove(self, key: str) -> bool:
        return self._blobs.pop(key, None) is not None

    def keys(self) -> Iterable[str]:
        return self._blobs.keys()


class Versioned:
    """Keeps every blob each key has had, oldest first."""

    def __init__(self) -> None:
        self._history: dict[str, list[str]] = {}

    def put(self, key: str, data: str) -> int:
        history = self._history.setdefault(key, [])
        history.append(data)
        return len(history)

    def latest(self, key: str) -> str | None:
        history = self._history.get(key)
        return None if history is None else history[-1]

    def version(self, key: str, version: int) -> str | None:
        history = self._history.get(key, [])
        return history[version - 1] if version <= len(history) else None

    def remove(self, key: str) -> bool:
        return self._history.pop(key, None) is not None

    def keys(self) -> Iterable[str]:
        return self._history.keys()


BACKENDS = {"plain": Plain, "versioned": Versioned}


def _named(key: str) -> None:
    if key == "":
        raise ValueError("keys are not empty")


class BlobStore:
    def __init__(self, backend: str) -> None:
        self._kind = backend
        self._backend = self._open(backend)

    @staticmethod
    def _open(kind: str) -> Backend:
        made = BACKENDS.get(kind)
        if made is None:
            raise ValueError("unknown backend")
        return made()

    def putBlob(self, key: str, data: str) -> int:
        _named(key)
        return self._backend.put(key, data)

    def fetch(self, key: str) -> str | None:
        _named(key)
        return self._backend.latest(key)

    def remove(self, key: str) -> bool:
        _named(key)
        return self._backend.remove(key)

    def listKeys(self, prefix: str) -> list[str]:
        return sorted(k for k in self._backend.keys() if k.startswith(prefix))

    def migrate(self, backend: str) -> int:
        if backend == self._kind:
            raise ValueError("already on that backend")
        target = self._open(backend)
        keys = list(self._backend.keys())
        for key in keys:
            data = self._backend.latest(key)
            # Every listed key has a latest blob; the check only narrows the type.
            if data is not None:
                target.put(key, data)
        self._kind = backend
        self._backend = target
        return len(keys)

    # The extension round: one more question for every backend, answered its own way.
    def fetchVersion(self, key: str, version: int) -> str | None:
        _named(key)
        if version < 1:
            raise ValueError("versions start at 1")
        return self._backend.version(key, version)
