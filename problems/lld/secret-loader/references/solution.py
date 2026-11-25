from __future__ import annotations

from collections.abc import Iterable


class _Vault:
    """Stands in for the remote vault: each round trip is counted, and a rotation issues
    the next version of a secret."""

    def __init__(self, names: list[str]) -> None:
        self._versions = {name: 1 for name in names}
        self.trips = 0

    def holds(self, name: str) -> bool:
        return name in self._versions

    def fetch(self, names: Iterable[str]) -> dict[str, str]:
        self.trips += 1
        return {name: f"{name}#{self._versions[name]}" for name in names}

    def rotate(self, name: str) -> None:
        self._versions[name] += 1


class SecretLoader:
    def __init__(self, names: list[str]) -> None:
        if "" in names:
            raise ValueError("names are not empty")
        if len(set(names)) < len(names):
            raise ValueError("names are unique")
        self._vault = _Vault(names)
        # A name is here only between its fetch and its next rotation.
        self._cache: dict[str, str] = {}

    def _known(self, name: str) -> None:
        if not self._vault.holds(name):
            raise KeyError("unknown secret")

    def reveal(self, name: str) -> str:
        self._known(name)
        if name not in self._cache:
            self._cache.update(self._vault.fetch([name]))
        return self._cache[name]

    def fetches(self) -> int:
        return self._vault.trips

    def rotate(self, name: str) -> None:
        self._known(name)
        self._vault.rotate(name)
        self._cache.pop(name, None)

    # The extension round: warm several secrets with one round trip.
    def prefetch(self, names: list[str]) -> int:
        for name in names:
            self._known(name)
        cold = sorted({name for name in names if name not in self._cache})
        if cold:
            self._cache.update(self._vault.fetch(cold))
        return len(cold)
