from __future__ import annotations

from abc import ABC, abstractmethod

MAX_RATE = 10**6
MAX_HOURS = 10**4


class Instance(ABC):
    """One instance: the hours it has run. Each kind turns them into cents its own way."""

    def __init__(self, hourly: int) -> None:
        self.hourly = hourly
        self.hours = 0

    def run(self, hours: int) -> None:
        self.hours += hours

    @abstractmethod
    def bill(self) -> int: ...

    def interrupt(self) -> bool:
        raise ValueError("only a spot instance can be interrupted")


class OnDemand(Instance):
    def bill(self) -> int:
        return self.hours * self.hourly


class Reserved(Instance):
    def bill(self) -> int:
        # 100 hours paid up front, then 60% of the rate over all the hours run.
        return 100 * self.hourly + self.hours * self.hourly * 60 // 100


class Spot(Instance):
    def __init__(self, hourly: int) -> None:
        super().__init__(hourly)
        self.interrupted = False

    # Once interrupted, runs are still accepted but no longer billed.
    def run(self, hours: int) -> None:
        if not self.interrupted:
            super().run(hours)

    def bill(self) -> int:
        return self.hours * self.hourly * 30 // 100

    def interrupt(self) -> bool:
        first = not self.interrupted
        self.interrupted = True
        return first


class Dedicated(Instance):
    def __init__(self, hourly: int, host_fee: int) -> None:
        super().__init__(hourly)
        self.host_fee = host_fee
        self.runs = 0

    def run(self, hours: int) -> None:
        super().run(hours)
        self.runs += 1

    def bill(self) -> int:
        return self.hours * self.hourly + self.runs * self.host_fee


KINDS: dict[str, type[Instance]] = {"on-demand": OnDemand, "reserved": Reserved, "spot": Spot}


def _rate(cents: int) -> int:
    if not 1 <= cents <= MAX_RATE:
        raise ValueError("hourlyCents must be within 1 and 10^6")
    return cents


class BillingMeter:
    def __init__(self) -> None:
        self._instances: dict[str, Instance] = {}

    def _add(self, id: str, instance: Instance) -> None:
        if id == "" or id in self._instances:
            raise ValueError("an instance needs a new, non-empty id")
        self._instances[id] = instance

    def _find(self, id: str) -> Instance:
        if id not in self._instances:
            raise KeyError("no such instance")
        return self._instances[id]

    def launch(self, id: str, kind: str, hourlyCents: int) -> None:
        if kind not in KINDS:
            raise ValueError("unknown kind")
        self._add(id, KINDS[kind](_rate(hourlyCents)))

    def run(self, id: str, hours: int) -> None:
        if not 1 <= hours <= MAX_HOURS:
            raise ValueError("hours must be within 1 and 10^4")
        self._find(id).run(hours)

    def bill(self, id: str) -> int:
        return self._find(id).bill()

    def total(self) -> int:
        return sum(i.bill() for i in self._instances.values())

    def interrupt(self, id: str) -> bool:
        return self._find(id).interrupt()

    # The extension round: a fourth kind, added without touching the others.
    def launchDedicated(self, id: str, hourlyCents: int, hostFeeCents: int) -> None:
        if not 0 <= hostFeeCents <= MAX_RATE:
            raise ValueError("hostFeeCents must be within 0 and 10^6")
        self._add(id, Dedicated(_rate(hourlyCents), hostFeeCents))
