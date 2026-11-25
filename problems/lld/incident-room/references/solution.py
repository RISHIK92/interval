from __future__ import annotations

MAX_MS = 10**15


def _named(*names: str) -> None:
    if "" in names:
        raise ValueError("ids, names and notes are not empty")


class _Incident:
    """Owns its timeline: nothing outside the incident appends to it."""

    def __init__(self, commander: str, now_ms: int) -> None:
        self.commander = commander
        self.responders = {commander}
        self.declared_at = now_ms
        self.resolved_at: int | None = None
        self.last_ms = now_ms
        self.lines: list[str] = []
        self.write(now_ms, f"declared by {commander}")

    def write(self, now_ms: int, text: str) -> None:
        self.last_ms = now_ms
        self.lines.append(f"{now_ms} {text}")


class IncidentRoom:
    def __init__(self) -> None:
        self._incidents: dict[str, _Incident] = {}

    @staticmethod
    def _timed(now_ms: int) -> None:
        if not 0 <= now_ms <= MAX_MS:
            raise ValueError("nowMs must be within 0 and 10^15")

    def _at(self, id: str, now_ms: int) -> _Incident:
        _named(id)
        self._timed(now_ms)
        incident = self._incidents.get(id)
        if incident is None:
            raise ValueError("unknown incident")
        if now_ms < incident.last_ms:
            raise ValueError("time went backwards")
        return incident

    def declareIncident(self, id: str, commander: str, nowMs: int) -> None:
        _named(id, commander)
        self._timed(nowMs)
        if id in self._incidents:
            raise ValueError("incident already declared")
        self._incidents[id] = _Incident(commander, nowMs)

    def joinIncident(self, id: str, responder: str, nowMs: int) -> bool:
        _named(responder)
        incident = self._at(id, nowMs)
        if responder in incident.responders:
            return False
        incident.responders.add(responder)
        incident.write(nowMs, f"{responder} joined")
        return True

    def note(self, id: str, author: str, text: str, nowMs: int) -> bool:
        _named(author, text)
        incident = self._at(id, nowMs)
        if author not in incident.responders or incident.resolved_at is not None:
            return False
        incident.write(nowMs, f"{author}: {text}")
        return True

    def handOff(self, id: str, to: str, nowMs: int) -> bool:
        _named(to)
        incident = self._at(id, nowMs)
        if to not in incident.responders or to == incident.commander:
            return False
        incident.write(nowMs, f"{incident.commander} handed off to {to}")
        incident.commander = to
        return True

    def timeline(self, id: str) -> list[str]:
        _named(id)
        incident = self._incidents.get(id)
        if incident is None:
            raise ValueError("unknown incident")
        return list(incident.lines)

    # The extension round: resolving closes the incident to notes.
    def resolve(self, id: str, nowMs: int) -> bool:
        incident = self._at(id, nowMs)
        if incident.resolved_at is not None:
            return False
        incident.resolved_at = nowMs
        incident.write(nowMs, "resolved")
        return True

    def durationMs(self, id: str) -> int:
        _named(id)
        incident = self._incidents.get(id)
        if incident is None:
            raise ValueError("unknown incident")
        if incident.resolved_at is None:
            raise ValueError("not resolved yet")
        return incident.resolved_at - incident.declared_at
