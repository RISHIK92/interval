from __future__ import annotations

import heapq
from abc import ABC, abstractmethod
from typing import Callable

# Each kind's required properties: the one table a new kind is added to.
REQUIRED: dict[str, list[str]] = {
    "bucket": ["region"],
    "queue": ["region"],
    "database": ["engine", "size"],
    "service": ["image", "port"],
    "worker": ["image"],
    "balancer": ["port"],
}


class Resource:
    def __init__(self, kind: str, name: str, props: dict[str, str]) -> None:
        self.kind = kind
        self.name = name
        self.props = dict(props)
        self.needs: list[str] = []  # resources this one depends on
        self.needed_by: list[str] = []  # resources that depend on this one


Links = Callable[[Resource], list[str]]


class Recipe(ABC):
    """An abstract factory for a family of resources that belong together. A recipe names
    its parts after the name it's given and says how they depend on each other."""

    @abstractmethod
    def resources(self, name: str) -> list[tuple[str, str, dict[str, str]]]: ...

    @abstractmethod
    def links(self, name: str) -> list[tuple[str, str]]: ...


class WebRecipe(Recipe):
    def resources(self, name: str) -> list[tuple[str, str, dict[str, str]]]:
        return [
            ("balancer", f"{name}-lb", {"port": "443"}),
            ("service", f"{name}-app", {"image": f"{name}:latest", "port": "8080"}),
            ("database", f"{name}-db", {"engine": "postgres", "size": "small"}),
        ]

    def links(self, name: str) -> list[tuple[str, str]]:
        return [(f"{name}-lb", f"{name}-app"), (f"{name}-app", f"{name}-db")]


class WorkerRecipe(Recipe):
    def resources(self, name: str) -> list[tuple[str, str, dict[str, str]]]:
        return [
            ("queue", f"{name}-jobs", {"region": "us-east-1"}),
            ("worker", f"{name}-worker", {"image": f"{name}:latest"}),
        ]

    def links(self, name: str) -> list[tuple[str, str]]:
        return [(f"{name}-worker", f"{name}-jobs")]


RECIPES: dict[str, Recipe] = {"web": WebRecipe(), "worker": WorkerRecipe()}


def _given(value: str) -> None:
    if value == "":
        raise ValueError("empty")


class StackBuilder:
    """A builder: resources and dependencies accumulate step by step, by hand or a recipe
    at a time, and nothing is ordered until the plan is asked for. Dependencies never form
    a cycle, because a link that would close one is refused when it's added."""

    def __init__(self, name: str) -> None:
        _given(name)
        self._stack = name
        self._resources: dict[str, Resource] = {}

    def resource(self, kind: str, name: str, props: dict[str, str]) -> bool:
        if kind not in REQUIRED:
            raise ValueError("unknown kind")
        _given(name)
        for key, value in props.items():
            _given(key)
            _given(value)
        if name in self._resources:
            return False
        self._resources[name] = Resource(kind, name, props)
        return True

    def dependsOn(self, a: str, b: str) -> bool:
        first, second = self._known(a), self._known(b)
        if a == b:
            raise ValueError("a resource can't depend on itself")
        if b in first.needs or a in self._reachable(b):
            return False
        first.needs.append(b)
        second.needed_by.append(a)
        return True

    def preset(self, recipe: str, name: str) -> int:
        found = RECIPES.get(recipe)
        if found is None:
            raise ValueError("unknown recipe")
        _given(name)
        parts = found.resources(name)
        if any(part in self._resources for _, part, _ in parts):
            return 0
        for kind, part, props in parts:
            self.resource(kind, part, props)
        for a, b in found.links(name):
            self.dependsOn(a, b)
        return len(parts)

    def validate(self) -> list[str]:
        problems = [
            f"{r.name}: missing {prop}"
            for r in self._resources.values()
            for prop in REQUIRED[r.kind]
            if prop not in r.props
        ]
        return sorted(problems)

    def plan(self) -> list[str]:
        if self.validate():
            raise ValueError("the stack isn't valid")
        return self._order(lambda r: r.needs, lambda r: r.needed_by)

    # The extension round: tearing the stack down.
    def destroyPlan(self) -> list[str]:
        return self._order(lambda r: r.needed_by, lambda r: r.needs)

    def _known(self, name: str) -> Resource:
        found = self._resources.get(name)
        if found is None:
            raise ValueError("unknown resource")
        return found

    def _reachable(self, start: str) -> set[str]:
        """Every resource `start` depends on, directly or not."""
        seen = {start}
        reached = [start]
        for name in reached:
            for need in self._resources[name].needs:
                if need not in seen:
                    seen.add(need)
                    reached.append(need)
        return seen

    def _order(self, before: Links, after: Links) -> list[str]:
        """Kahn's algorithm: a resource comes once everything `before` it has, and among
        those ready, the smallest name goes first."""
        waiting = {r.name: len(before(r)) for r in self._resources.values()}
        ready = [name for name, count in waiting.items() if count == 0]
        heapq.heapify(ready)
        out: list[str] = []
        for _ in range(len(waiting)):
            resource = self._resources[heapq.heappop(ready)]
            out.append(f"{resource.kind} {self._stack}/{resource.name}")
            for name in after(resource):
                waiting[name] -= 1
                if waiting[name] == 0:
                    heapq.heappush(ready, name)
        return out
