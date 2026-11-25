from __future__ import annotations

from typing import Protocol


class Meter:
    """Fees charged and restores made so far, by reads and (in the extension) moves."""

    def __init__(self) -> None:
        self.fees = 0
        self.restores = 0


class Stored:
    def __init__(self, data: str, storage_class: StorageClass) -> None:
        self.data = data
        self.storage_class = storage_class
        self.restored = False


class StorageClass(Protocol):
    """Every class keeps the same promise: read hands back exactly what was stored. They
    differ only in what that costs, so the bucket never asks which class an object is in."""

    rate: int

    def read(self, stored: Stored, meter: Meter) -> str: ...

    def leave(self, stored: Stored, meter: Meter) -> None: ...


class Standard:
    rate = 4

    def read(self, stored: Stored, meter: Meter) -> str:
        return stored.data

    def leave(self, stored: Stored, meter: Meter) -> None:
        pass


class InfrequentAccess:
    rate = 2

    def read(self, stored: Stored, meter: Meter) -> str:
        meter.fees += len(stored.data)
        return stored.data

    def leave(self, stored: Stored, meter: Meter) -> None:
        pass


class Archive:
    """Slow to reach, never absent: the first read restores the object, and pays for it,
    instead of failing or answering null."""

    rate = 1

    def read(self, stored: Stored, meter: Meter) -> str:
        self.leave(stored, meter)
        return stored.data

    def leave(self, stored: Stored, meter: Meter) -> None:
        if not stored.restored:
            meter.restores += 1
            meter.fees += 3 * len(stored.data)
            stored.restored = True


CLASSES: dict[str, StorageClass] = {
    "standard": Standard(),
    "infrequent-access": InfrequentAccess(),
    "archive": Archive(),
}


def _named(key: str) -> None:
    if key == "":
        raise ValueError("empty key")


def _class(name: str) -> StorageClass:
    found = CLASSES.get(name)
    if found is None:
        raise ValueError("unknown storage class")
    return found


class StorageBucket:
    def __init__(self) -> None:
        self._objects: dict[str, Stored] = {}
        self._meter = Meter()

    def store(self, key: str, data: str, storageClass: str) -> None:
        _named(key)
        self._objects[key] = Stored(data, _class(storageClass))

    def read(self, key: str) -> str | None:
        _named(key)
        stored = self._objects.get(key)
        if stored is None:
            return None
        return stored.storage_class.read(stored, self._meter)

    def restores(self) -> int:
        return self._meter.restores

    def monthlyCost(self) -> int:
        keeping = sum(s.storage_class.rate * len(s.data) for s in self._objects.values())
        return keeping + self._meter.fees

    # The extension round: a lifecycle move, which each class leaves in its own way.
    def transition(self, key: str, storageClass: str) -> bool:
        _named(key)
        target = _class(storageClass)
        stored = self._objects.get(key)
        if stored is None or stored.storage_class is target:
            return False
        stored.storage_class.leave(stored, self._meter)
        self._objects[key] = Stored(stored.data, target)
        return True
