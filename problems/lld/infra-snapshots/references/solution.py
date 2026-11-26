from __future__ import annotations

Resources = dict[str, dict[str, str]]


def _copy(resources: Resources) -> Resources:
    return {name: dict(attrs) for name, attrs in resources.items()}


class Snapshot:
    """The memento: a frozen copy of the state that only InfraState reads back."""

    def __init__(self, label: str, resources: Resources) -> None:
        self.label = label
        self._resources = _copy(resources)

    def resources(self) -> Resources:
        return _copy(self._resources)


class InfraState:
    def __init__(self) -> None:
        self._resources: Resources = {}
        # The caretaker's side: snapshots by id, known here only by their labels.
        self._snapshots: dict[int, Snapshot] = {}
        self._last_id = 0

    def apply(self, resource: str, attrs: dict[str, str]) -> None:
        if resource == "" or any(k == "" or v == "" for k, v in attrs.items()):
            raise ValueError("empty name or value")
        self._resources[resource] = dict(attrs)

    def destroy(self, resource: str) -> bool:
        if resource == "":
            raise ValueError("empty resource")
        return self._resources.pop(resource, None) is not None

    def snapshot(self, label: str) -> int:
        if label == "":
            raise ValueError("empty label")
        for sid, snap in list(self._snapshots.items()):
            if snap.label == label:
                del self._snapshots[sid]
        self._last_id += 1
        self._snapshots[self._last_id] = Snapshot(label, self._resources)
        return self._last_id

    def restore(self, snapshotId: int) -> bool:
        snap = self._snapshots.get(snapshotId)
        if snap is None:
            return False
        self._resources = snap.resources()
        return True

    def diffSince(self, snapshotId: int) -> list[str]:
        snap = self._snapshots.get(snapshotId)
        if snap is None:
            raise ValueError("unknown snapshot")
        then = snap.resources()
        out: list[str] = []
        for name in sorted(then.keys() | self._resources.keys()):
            before, now = then.get(name), self._resources.get(name)
            if before is None:
                out.append(f"+ {name}")
            elif now is None:
                out.append(f"- {name}")
            else:
                keys = sorted(
                    k for k in before.keys() | now.keys() if before.get(k) != now.get(k)
                )
                if keys:
                    out.append(f"~ {name}: {','.join(keys)}")
        return out

    # The extension round: keeping only the newest snapshots.
    def prune(self, keep: int) -> int:
        if keep < 0:
            raise ValueError("negative keep")
        ids = sorted(self._snapshots)
        dropped = ids[: max(len(ids) - keep, 0)]
        for sid in dropped:
            del self._snapshots[sid]
        return len(dropped)
