from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Callable


class Node(ABC):
    """A component: a rule (a leaf) or a group (a composite). Callers evaluate, count
    and mute either the same way, without asking which one they hold."""

    def __init__(self, name: str, parent: Group | None) -> None:
        self.name = name
        self.parent = parent
        self.muted = False

    def path(self) -> str:
        if self.parent is None:
            return "/"
        above = self.parent.path()
        return f"{above}{self.name}" if above == "/" else f"{above}/{self.name}"

    @abstractmethod
    def firing(self, metrics: dict[str, int], out: list[str]) -> None:
        """Adds the paths of this node's unmuted rules that fire."""

    @abstractmethod
    def count(self) -> int: ...


class Rule(Node):
    def __init__(self, name: str, parent: Group, metric: str, threshold: int) -> None:
        super().__init__(name, parent)
        self.metric = metric
        self.threshold = threshold

    def firing(self, metrics: dict[str, int], out: list[str]) -> None:
        value = metrics.get(self.metric)
        if not self.muted and value is not None and value > self.threshold:
            out.append(self.path())

    def count(self) -> int:
        return 1


class Group(Node):
    def __init__(self, name: str, parent: Group | None) -> None:
        super().__init__(name, parent)
        self.children: dict[str, Node] = {}

    def firing(self, metrics: dict[str, int], out: list[str]) -> None:
        # A muted group silences everything under it, whatever their own flags say.
        if not self.muted:
            for child in self.children.values():
                child.firing(metrics, out)

    def count(self) -> int:
        return sum(child.count() for child in self.children.values())


def _name(name: str) -> None:
    if name == "" or "/" in name:
        raise ValueError("a name is non-empty and has no slash")


class AlertTree:
    def __init__(self) -> None:
        self._root = Group("", None)

    def group(self, parent: str, name: str) -> bool:
        at = self._group(parent)
        _name(name)
        return self._attach(at, name, lambda: Group(name, at))

    def rule(self, parent: str, name: str, metric: str, threshold: int) -> bool:
        at = self._group(parent)
        _name(name)
        if metric == "":
            raise ValueError("empty metric")
        return self._attach(at, name, lambda: Rule(name, at, metric, threshold))

    def mute(self, node: str, on: bool) -> bool:
        found = self._find(node)
        if found.muted == on:
            return False
        found.muted = on
        return True

    def firing(self, metrics: dict[str, int]) -> list[str]:
        out: list[str] = []
        self._root.firing(metrics, out)
        return sorted(out)

    def count(self, node: str) -> int:
        return self._find(node).count()

    # The extension round: moving a subtree, with its mutes.
    def moveNode(self, node: str, parent: str) -> bool:
        moving = self._find(node)
        to = self._group(parent)
        if moving.parent is None:
            raise ValueError("the root stays where it is")
        # A group can't go under itself or anything below it: that would cut it off.
        inside = (to.path() + "/").startswith(moving.path() + "/")
        if inside or moving.name in to.children:
            return False
        del moving.parent.children[moving.name]
        moving.parent = to
        to.children[moving.name] = moving
        return True

    @staticmethod
    def _attach(at: Group, name: str, make: Callable[[], Node]) -> bool:
        if name in at.children:
            return False
        at.children[name] = make()
        return True

    def _find(self, path: str) -> Node:
        if path == "/":
            return self._root
        if not path.startswith("/"):
            raise ValueError("a path starts with a slash")
        at: Node = self._root
        for part in path[1:].split("/"):
            # A rule has no children, so nothing is under it.
            children = at.children if isinstance(at, Group) else {}
            if part not in children:
                raise ValueError("no such node")
            at = children[part]
        return at

    def _group(self, path: str) -> Group:
        found = self._find(path)
        if not isinstance(found, Group):
            raise ValueError("a rule has no children")
        return found
