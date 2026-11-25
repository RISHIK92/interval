from __future__ import annotations


def _named(*names: str) -> None:
    if "" in names:
        raise ValueError("package names are not empty")


class PackageGraph:
    """Each package keeps the packages it uses, in declared order, and the reverse links
    to its dependents. Dependencies must already exist, so the graph never has a cycle."""

    def __init__(self) -> None:
        self._deps: dict[str, list[str]] = {}
        self._dependents: dict[str, set[str]] = {}
        self._pinned: set[str] = set()

    def _known(self, pkg: str) -> None:
        _named(pkg)
        if pkg not in self._deps:
            raise ValueError("unknown package")

    def add(self, pkg: str, deps: list[str]) -> bool:
        _named(pkg, *deps)
        if len(set(deps)) != len(deps):
            raise ValueError("a dependency is listed twice")
        if pkg in self._deps or any(d not in self._deps for d in deps):
            return False
        self._deps[pkg] = list(deps)
        self._dependents[pkg] = set()
        for d in deps:
            self._dependents[d].add(pkg)
        return True

    def remove(self, pkg: str) -> bool:
        _named(pkg)
        if pkg not in self._deps or self._dependents[pkg]:
            return False
        for d in self._deps.pop(pkg):
            self._dependents[d].discard(pkg)
        del self._dependents[pkg]
        self._pinned.discard(pkg)
        return True

    def dependents(self, pkg: str) -> list[str]:
        self._known(pkg)
        return sorted(self._dependents[pkg])

    def installOrder(self, pkg: str) -> list[str]:
        self._known(pkg)
        order: list[str] = []
        listed: set[str] = set()

        def visit(p: str) -> None:
            if p in listed:
                return
            for d in self._deps[p]:
                visit(d)
            listed.add(p)
            order.append(p)

        visit(pkg)
        return order

    # The extension round: pinned packages are never unused.
    def pin(self, pkg: str) -> None:
        self._known(pkg)
        self._pinned.add(pkg)

    def unused(self) -> list[str]:
        return sorted(p for p, users in self._dependents.items() if not users and p not in self._pinned)
