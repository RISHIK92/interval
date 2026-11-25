from __future__ import annotations

MAX_SIZE_GB = 65_536
OPS = ("snapshot", "resize", "encrypt")


class Volume:
    def __init__(self, name: str, size: int) -> None:
        self.name = name
        self.size = size
        self.snapshots: dict[str, int] = {}


# Each operation is its own narrow capability. A driver holds only the ones it has, so the
# manager can't call an operation a driver lacks: it finds no capability and fails.
class Snapshots:
    def take(self, volume: Volume) -> str:
        snapshot = f"{volume.name}@{len(volume.snapshots) + 1}"
        volume.snapshots[snapshot] = volume.size
        return snapshot

    def restore(self, volume: Volume, snapshot: str) -> bool:
        if snapshot not in volume.snapshots:
            return False
        volume.size = volume.snapshots[snapshot]
        return True


class Resizing:
    def grow(self, volume: Volume, size: int) -> bool:
        if size <= volume.size:
            return False
        volume.size = size
        return True


# "encrypt" is a known operation, but no call here needs it, so it has no capability yet.
class Driver:
    def __init__(self, ops: list[str]) -> None:
        if len(set(ops)) != len(ops) or any(op not in OPS for op in ops):
            raise ValueError("ops are distinct, from snapshot, resize and encrypt")
        self.snapshots = Snapshots() if "snapshot" in ops else None
        self.resizing = Resizing() if "resize" in ops else None


def _named(text: str) -> str:
    if text == "":
        raise ValueError("an empty name")
    return text


def _size(size_gb: int) -> int:
    if not 1 <= size_gb <= MAX_SIZE_GB:
        raise ValueError("a size is 1 to 65536 GB")
    return size_gb


class VolumeManager:
    def __init__(self) -> None:
        self._drivers: dict[str, Driver] = {}
        self._volumes: dict[str, tuple[Volume, Driver]] = {}

    def driver(self, name: str, ops: list[str]) -> None:
        if _named(name) in self._drivers:
            raise ValueError("a driver is registered once")
        self._drivers[name] = Driver(ops)

    def create(self, volume: str, driver: str, sizeGb: int) -> bool:
        _named(volume)
        if driver not in self._drivers:
            raise KeyError("an unknown driver")
        size = _size(sizeGb)
        if volume in self._volumes:
            return False
        self._volumes[volume] = (Volume(volume, size), self._drivers[driver])
        return True

    def snapshot(self, volume: str) -> str:
        found, snapshots = self._snapshots(volume)
        return snapshots.take(found)

    def resize(self, volume: str, sizeGb: int) -> bool:
        found, driver = self._volume(volume)
        if driver.resizing is None:
            raise ValueError("the driver can't resize")
        return driver.resizing.grow(found, _size(sizeGb))

    def snapshots(self, volume: str) -> list[str]:
        found, _ = self._snapshots(volume)
        return list(found.snapshots)

    # The extension round.
    def restore(self, volume: str, snapshot: str) -> bool:
        found, snapshots = self._snapshots(volume)
        return snapshots.restore(found, _named(snapshot))

    def _volume(self, volume: str) -> tuple[Volume, Driver]:
        if volume not in self._volumes:
            raise KeyError("an unknown volume")
        return self._volumes[volume]

    def _snapshots(self, volume: str) -> tuple[Volume, Snapshots]:
        found, driver = self._volume(volume)
        if driver.snapshots is None:
            raise ValueError("the driver can't snapshot")
        return found, driver.snapshots
