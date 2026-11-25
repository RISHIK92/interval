from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Callable


class Family(ABC):
    """An abstract factory: one family's way of making each kind of component. The kit
    only ever asks the family in use, so every component it makes belongs together."""

    def __init__(self, name: str) -> None:
        self.name = name

    @abstractmethod
    def queue(self) -> str: ...

    @abstractmethod
    def store(self) -> str: ...

    @abstractmethod
    def clock(self) -> str: ...


class Local(Family):
    def queue(self) -> str:
        return "inmem-queue"

    def store(self) -> str:
        return "sqlite-store"

    def clock(self) -> str:
        return "fake-clock"


class Ci(Family):
    def queue(self) -> str:
        return "valkey-queue"

    def store(self) -> str:
        return "postgres-store"

    def clock(self) -> str:
        return "fixed-clock"


class Staging(Family):
    def queue(self) -> str:
        return "sqs-queue"

    def store(self) -> str:
        return "rds-store"

    def clock(self) -> str:
        return "system-clock"


class Prefixed(Family):
    """A family defined at run time: its components are named after its prefix."""

    def __init__(self, name: str, prefix: str) -> None:
        super().__init__(name)
        self._prefix = prefix

    def queue(self) -> str:
        return f"{self._prefix}-queue"

    def store(self) -> str:
        return f"{self._prefix}-store"

    def clock(self) -> str:
        return f"{self._prefix}-clock"


# Each kind is one of the factory's methods; the kit never names a concrete family.
KINDS: dict[str, Callable[[Family], str]] = {
    "queue": lambda f: f.queue(),
    "store": lambda f: f.store(),
    "clock": lambda f: f.clock(),
}


class EnvKit:
    def __init__(self) -> None:
        self._families: dict[str, Family] = {f.name: f for f in (Local("local"), Ci("ci"), Staging("staging"))}
        self._current: Family | None = None
        self._made: dict[str, str] = {}  # component id -> family name

    def use(self, family: str) -> None:
        found = self._families.get(family)
        if found is None:
            raise ValueError("unknown family")
        self._current = found

    def component(self, kind: str) -> str:
        make = KINDS.get(kind)
        if make is None:
            raise ValueError("unknown kind")
        if self._current is None:
            raise ValueError("no family in use")
        made = f"{make(self._current)}#{len(self._made) + 1}"
        self._made[made] = self._current.name
        return made

    def wire(self, a: str, b: str) -> bool:
        if a == b:
            raise ValueError("a component can't be wired to itself")
        return self.family(a) == self.family(b)

    def family(self, componentId: str) -> str:
        found = self._made.get(componentId)
        if found is None:
            raise ValueError("unknown component")
        return found

    # The extension round: a family that isn't built in.
    def defineFamily(self, name: str, prefix: str) -> None:
        if name == "" or prefix == "":
            raise ValueError("empty")
        if name in self._families:
            raise ValueError("family exists")
        self._families[name] = Prefixed(name, prefix)
