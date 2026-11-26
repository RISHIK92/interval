from __future__ import annotations


class Level:
    """One link in the chain: its person is paged in turn, and when they don't
    acknowledge in time the page moves on to the next link, if there is one."""

    def __init__(self, person: str, after: Level | None) -> None:
        self.person = person
        self.after = after


class Incident:
    def __init__(self, level: Level, holder: str, since: int) -> None:
        self.level = level
        self.holder = holder
        self.since = since
        self.acked = False


class Escalation:
    def __init__(self, levels: list[str], ackTimeoutMs: int) -> None:
        if not levels or "" in levels or len(set(levels)) != len(levels) or ackTimeoutMs < 1:
            raise ValueError("bad levels or timeout")
        first: Level | None = None
        for person in reversed(levels):
            first = Level(person, first)
        self._first: Level = first  # type: ignore[assignment]
        self._people = set(levels)
        self._timeout = ackTimeoutMs
        self._incidents: dict[str, Incident] = {}
        self._cover: dict[str, str] = {}
        self._now = 0

    def _clock(self, nowMs: int) -> None:
        if nowMs < self._now:
            raise ValueError("time went backwards")
        self._now = nowMs

    def _paged(self, level: Level) -> str:
        return self._cover.get(level.person, level.person)

    def page(self, incident: str, nowMs: int) -> str:
        if incident == "" or incident in self._incidents:
            raise ValueError("an empty or known incident")
        self._clock(nowMs)
        holder = self._paged(self._first)
        self._incidents[incident] = Incident(self._first, holder, nowMs)
        return holder

    def tick(self, nowMs: int) -> list[str]:
        self._clock(nowMs)
        moved: list[str] = []
        for name in sorted(self._incidents):
            incident = self._incidents[name]
            after = incident.level.after
            if incident.acked or after is None or nowMs - incident.since < self._timeout:
                continue
            incident.level = after
            incident.holder = self._paged(after)
            incident.since = nowMs
            moved.append(name + " -> " + incident.holder)
        return moved

    def ack(self, incident: str, person: str, nowMs: int) -> bool:
        if incident == "" or person == "":
            raise ValueError("an empty name")
        self._clock(nowMs)
        found = self._incidents.get(incident)
        if found is None or found.acked or found.holder != person:
            return False
        found.acked = True
        return True

    def holder(self, incident: str) -> str | None:
        if incident == "":
            raise ValueError("an empty incident")
        found = self._incidents.get(incident)
        return None if found is None else found.holder

    # The extension round: holiday cover, applied whenever someone is paged from now on.
    def cover(self, person: str, substitute: str) -> None:
        if person not in self._people or substitute == "":
            raise ValueError("not on call, or an empty substitute")
        if substitute == person:
            self._cover.pop(person, None)
        else:
            self._cover[person] = substitute
