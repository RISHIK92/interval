from __future__ import annotations

from bisect import bisect_right, insort

MAX_VERSION = 10**9


def _require(condition: bool, why: str) -> None:
    """A broken precondition fails the call before anything changes."""
    if not condition:
        raise ValueError(why)


class MigrationPlan:
    """Invariant: the applied migrations are exactly the lowest `_applied` versions, so
    the current version is the last of them and everything above it is pending."""

    def __init__(self) -> None:
        self._names: dict[int, str] = {}
        self._versions: list[int] = []
        self._applied = 0
        self._irreversible: set[int] = set()

    def add(self, version: int, name: str) -> None:
        _require(1 <= version <= MAX_VERSION, "versions are within 1 and 10^9")
        _require(name != "", "a migration has a name")
        _require(version not in self._names, "that version is already planned")
        # It must land above every applied migration, or it could never be applied.
        above = bisect_right(self._versions, version) >= self._applied
        _require(above, "that version is below the current one")
        self._names[version] = name
        insort(self._versions, version)

    def applyUpTo(self, version: int) -> list[str]:
        _require(version in self._names, "unknown version")
        _require(version >= self.current(), "applying never goes down")
        start = self._applied
        self._applied = bisect_right(self._versions, version)
        return [self._names[v] for v in self._versions[start : self._applied]]

    def rollback(self, steps: int) -> list[str]:
        _require(
            1 <= steps <= self._applied, "steps are within 1 and the applied count"
        )
        undone = self._versions[self._applied - steps : self._applied][::-1]
        _require(
            not self._irreversible.intersection(undone),
            "an irreversible migration is in the way",
        )
        self._applied -= steps
        return [self._names[v] for v in undone]

    def current(self) -> int:
        return self._versions[self._applied - 1] if self._applied > 0 else 0

    def pending(self) -> list[int]:
        return self._versions[self._applied :]

    # The extension round: one more precondition on rollback.
    def irreversible(self, version: int) -> None:
        _require(version in self._names, "unknown version")
        self._irreversible.add(version)
