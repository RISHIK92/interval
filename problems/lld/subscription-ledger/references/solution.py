from __future__ import annotations

from collections.abc import Callable
from typing import NamedTuple

MAX_TIER = 100
MAX_PAUSE_MS = 1_000_000_000
MAX_MS = 1_000_000_000_000
MAX_EVERY = 10_000


class State(NamedTuple):
    """A subscription at one moment. Immutable, so a snapshot (a memento) is just a
    reference to one; None stands for a subscription not created yet."""

    status: str
    tier: int
    paused_until: int

    def shown(self, now: int) -> str:
        if self.status == "active" and now < self.paused_until:
            return f"paused:{self.tier}"
        return f"{self.status}:{self.tier}"


def _shown(state: State | None, now: int) -> str:
    return "none" if state is None else state.shown(now)


class Event(NamedTuple):
    at: int
    name: str
    arg: int


def _created(s: State | None, e: Event) -> State:
    return State("active", e.arg, e.at)


def _changed(s: State | None, **change: str | int) -> State:
    if s is None:
        raise AssertionError("only created comes first")
    return s._replace(**change)


# What each event does to a state, by its kind.
APPLY: dict[str, Callable[[State | None, Event], State]] = {
    "created": _created,
    "upgraded": lambda s, e: _changed(s, tier=e.arg),
    "paused": lambda s, e: _changed(s, paused_until=e.at + e.arg),
    "cancelled": lambda s, e: _changed(s, status="cancelled"),
}


def _running(state: State | None, now: int) -> bool:
    return _shown(state, now).startswith("active:")


class Command:
    """A request: its argument's range, and the rule it's checked by against the
    current state. If it's allowed, it becomes an event of `kind`."""

    def __init__(
        self,
        kind: str,
        low: int,
        high: int,
        allowed: Callable[[State | None, int, int], bool],
    ) -> None:
        self.kind = kind
        self.low = low
        self.high = high
        self.allowed = allowed

    def valid(self, arg: int) -> bool:
        return self.low <= arg <= self.high


COMMANDS = {
    "create": Command("created", 1, MAX_TIER, lambda s, arg, now: s is None),
    "upgrade": Command(
        "upgraded",
        1,
        MAX_TIER,
        lambda s, arg, now: _running(s, now) and s is not None and arg > s.tier,
    ),
    "pause": Command("paused", 1, MAX_PAUSE_MS, lambda s, arg, now: _running(s, now)),
    "cancel": Command(
        "cancelled", 0, 0, lambda s, arg, now: s is not None and s.status == "active"
    ),
}


class Stream:
    """One subscription's events, its current state, and snapshots: (events covered,
    state after them)."""

    def __init__(self) -> None:
        self.events: list[Event] = []
        self.current: State | None = None
        self.snapshots: list[tuple[int, State]] = []


class SubscriptionLedger:
    def __init__(self) -> None:
        self._streams: dict[str, Stream] = {}
        self._every: int | None = None
        self._replays = 0
        self._last = 0
        # An upcaster: an old event name and the newer name it's read under.
        self._renamed: dict[str, str] = {}
        self._kinds = {kind: kind for kind in APPLY}  # current name -> kind

    def handle(self, command: str, sub: str, arg: int, nowMs: int) -> bool:
        found = COMMANDS.get(command)
        if found is None or sub == "" or not found.valid(arg):
            raise ValueError("an unknown command, an empty sub or a bad arg")
        if nowMs < self._last or nowMs > MAX_MS:
            raise ValueError("time runs forward, up to 10^12")
        self._last = nowMs
        stream = self._streams.setdefault(sub, Stream())
        if not found.allowed(stream.current, arg, nowMs):
            return False
        event = Event(nowMs, self._name(found.kind), arg)
        stream.events.append(event)
        state = APPLY[found.kind](stream.current, event)
        stream.current = state
        if self._every is not None and len(stream.events) % self._every == 0:
            stream.snapshots.append((len(stream.events), state))
        return True

    def events(self, sub: str) -> list[str]:
        stream = self._stream(sub)
        return [f"{e.at}:{self._read(e.name)}:{e.arg}" for e in stream.events]

    def stateAt(self, sub: str, nowMs: int) -> str:
        stream = self._stream(sub)
        if nowMs < 0 or nowMs > MAX_MS:
            raise ValueError("a time runs from 0 to 10^12")
        covered, state = 0, None
        for count, snapshot in stream.snapshots:
            if stream.events[count - 1].at <= nowMs:
                covered, state = count, snapshot
        for event in stream.events[covered:]:
            if event.at > nowMs:
                break
            state = APPLY[self._kinds[self._read(event.name)]](state, event)
            self._replays += 1
        return _shown(state, nowMs)

    def snapshotEvery(self, n: int) -> None:
        if n < 1 or n > MAX_EVERY:
            raise ValueError("n runs from 1 to 10^4")
        self._every = n

    def replays(self) -> int:
        return self._replays

    # The extension round: old events read under a new schema name.
    def upcast(self, eventName: str, newName: str) -> None:
        kind = self._kinds.get(eventName)
        if kind is None or not newName.isalnum() or not newName.isascii():
            raise ValueError("not a current name, or a bad new name")
        if newName in self._kinds or newName in self._renamed:
            raise ValueError("a name is never used twice")
        self._renamed[eventName] = newName
        del self._kinds[eventName]
        self._kinds[newName] = kind

    def _name(self, kind: str) -> str:
        return next(name for name, k in self._kinds.items() if k == kind)

    def _read(self, name: str) -> str:
        # Each name is renamed at most once and never reused, so this ends.
        for _ in range(len(self._renamed)):
            name = self._renamed.get(name, name)
        return name

    def _stream(self, sub: str) -> Stream:
        if sub == "":
            raise ValueError("an empty sub")
        return self._streams.get(sub, Stream())
