from __future__ import annotations

from abc import ABC, abstractmethod


class CostNode(ABC):
    """A component: a service (a leaf) or a unit (a composite). Anyone asking for a
    total asks the node, whichever it is."""

    def __init__(self, name: str, parent: Unit | None) -> None:
        self.name = name
        self.parent = parent
        self.shared = 0  # cents allocated to this node from above (the extension)

    @abstractmethod
    def total(self) -> int: ...

    @abstractmethod
    def children(self) -> list[CostNode]: ...


class Service(CostNode):
    def __init__(self, name: str, parent: Unit, cents: int) -> None:
        super().__init__(name, parent)
        self.cents = cents

    def total(self) -> int:
        return self.cents + self.shared

    def children(self) -> list[CostNode]:
        return []


class Unit(CostNode):
    def __init__(self, name: str, parent: Unit | None) -> None:
        super().__init__(name, parent)
        self.members: dict[str, CostNode] = {}

    def total(self) -> int:
        return self.shared + sum(child.total() for child in self.members.values())

    def children(self) -> list[CostNode]:
        return list(self.members.values())

    def within(self, node: CostNode) -> bool:
        """Whether this unit is node itself or somewhere under it."""
        return self is node or (self.parent is not None and self.parent.within(node))


def _given(value: str) -> None:
    if value == "":
        raise ValueError("empty")


def _order(node: CostNode) -> tuple[int, str]:
    return (-node.total(), node.name)


class CostTree:
    def __init__(self, root: str) -> None:
        _given(root)
        self._nodes: dict[str, CostNode] = {root: Unit(root, None)}

    def unit(self, parent: str, name: str) -> bool:
        at = self._unit(parent)
        _given(name)
        return self._attach(at, Unit(name, at))

    def service(self, parent: str, name: str, cents: int) -> bool:
        at = self._unit(parent)
        _given(name)
        if cents < 0:
            raise ValueError("a cost is never negative")
        return self._attach(at, Service(name, at, cents))

    def total(self, node: str) -> int:
        return self._find(node).total()

    def move(self, node: str, parent: str) -> bool:
        moving = self._find(node)
        to = self._unit(parent)
        if moving.parent is None:
            raise ValueError("the root stays where it is")
        if moving.parent is to or to.within(moving):
            return False
        del moving.parent.members[moving.name]
        moving.parent = to
        to.members[moving.name] = moving
        return True

    def top(self, node: str, n: int) -> list[str]:
        found = self._find(node)
        if n < 0:
            raise ValueError("n is never negative")
        ranked = sorted(found.children(), key=_order)[:n]
        return [f"{child.name} {child.total()}" for child in ranked]

    # The extension round: a cost shared by everything directly under a unit.
    def sharedCost(self, node: str, cents: int) -> None:
        found = self._unit(node)
        if cents < 0:
            raise ValueError("a cost is never negative")
        children = sorted(found.children(), key=lambda child: child.name)
        if not children:
            raise ValueError("nothing to share with")
        each, extra = divmod(cents, len(children))
        for i, child in enumerate(children):
            child.shared += each + (1 if i < extra else 0)

    def _attach(self, at: Unit, node: CostNode) -> bool:
        if node.name in self._nodes:
            return False
        at.members[node.name] = node
        self._nodes[node.name] = node
        return True

    def _find(self, name: str) -> CostNode:
        found = self._nodes.get(name)
        if found is None:
            raise ValueError("no such node")
        return found

    def _unit(self, name: str) -> Unit:
        found = self._find(name)
        if not isinstance(found, Unit):
            raise ValueError("a service has nothing under it")
        return found
