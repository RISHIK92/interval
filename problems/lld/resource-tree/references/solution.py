from __future__ import annotations

PARENT_KIND = {"folder": "organization", "project": "folder", "resource": "project"}


def _named(*names: str) -> None:
    if "" in names:
        raise ValueError("names, kinds, roles and members are not empty")


class ResourceTree:
    """Nodes compose: each holds its children, and removing one takes its subtree.
    Grants associate a member with a node by name; members are never nodes."""

    def __init__(self, org: str) -> None:
        _named(org)
        self._org = org
        self._kind: dict[str, str] = {org: "organization"}
        self._parent: dict[str, str | None] = {org: None}
        self._children: dict[str, set[str]] = {org: set()}
        self._grants: dict[str, set[tuple[str, str]]] = {org: set()}
        self._denies: dict[str, set[tuple[str, str]]] = {org: set()}

    def _known(self, node: str) -> None:
        _named(node)
        if node not in self._kind:
            raise ValueError("unknown node")

    def _fits(self, kind: str, parent: str) -> bool:
        return PARENT_KIND[kind] == self._kind[parent]

    def _path(self, node: str) -> list[str]:
        out: list[str] = []
        at: str | None = node
        while at is not None:
            out.append(at)
            at = self._parent[at]
        return out

    def addNode(self, parent: str, node: str, kind: str) -> bool:
        _named(parent, node, kind)
        if kind not in PARENT_KIND:
            raise ValueError("unknown kind")
        if parent not in self._kind or node in self._kind or not self._fits(kind, parent):
            return False
        self._kind[node] = kind
        self._parent[node] = parent
        self._children[node] = set()
        self._children[parent].add(node)
        self._grants[node] = set()
        self._denies[node] = set()
        return True

    def attach(self, node: str, role: str, member: str) -> None:
        _named(role, member)
        self._known(node)
        self._grants[node].add((role, member))

    def can(self, member: str, role: str, node: str) -> bool:
        _named(member, role)
        self._known(node)
        path = self._path(node)
        if any((role, member) in self._denies[n] for n in path):
            return False
        return any((role, member) in self._grants[n] for n in path)

    def move(self, node: str, parent: str) -> bool:
        _named(node, parent)
        if node not in self._kind or parent not in self._kind or node == self._org:
            return False
        if not self._fits(self._kind[node], parent):
            return False
        old = self._parent[node]
        assert old is not None  # only the organization has no parent
        self._children[old].discard(node)
        self._children[parent].add(node)
        self._parent[node] = parent
        return True

    def remove(self, node: str) -> int:
        self._known(node)
        if node == self._org:
            raise ValueError("the organization can't be removed")
        parent = self._parent[node]
        assert parent is not None
        self._children[parent].discard(node)
        return self._drop(node)

    def _drop(self, node: str) -> int:
        count = 1
        for child in self._children[node]:
            count += self._drop(child)
        for table in (self._kind, self._parent, self._children, self._grants, self._denies):
            del table[node]
        return count

    # The extension round: a deny below or above overrides every grant.
    def deny(self, node: str, role: str, member: str) -> None:
        _named(role, member)
        self._known(node)
        self._denies[node].add((role, member))
