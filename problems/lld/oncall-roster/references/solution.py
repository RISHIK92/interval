from __future__ import annotations


def _named(*names: str) -> None:
    if "" in names:
        raise ValueError("names are not empty")


class OncallRoster:
    """Teams aggregate engineers: a team holds its members' names in join order, and
    each engineer knows their teams. Disbanding drops only the team's side and the links."""

    def __init__(self) -> None:
        self._teams_of: dict[str, set[str]] = {}
        self._members: dict[str, list[str]] = {}
        self._last_on_call: dict[str, int] = {}

    def addEngineer(self, name: str) -> None:
        _named(name)
        if name in self._teams_of:
            raise ValueError("engineer already on the roster")
        self._teams_of[name] = set()

    def addTeam(self, team: str) -> None:
        _named(team)
        if team in self._members:
            raise ValueError("team already exists")
        self._members[team] = []

    def join(self, team: str, name: str) -> bool:
        _named(team, name)
        if team not in self._members:
            raise ValueError("unknown team")
        if name not in self._teams_of:
            raise ValueError("unknown engineer")
        if team in self._teams_of[name]:
            return False
        self._members[team].append(name)
        self._teams_of[name].add(team)
        return True

    def disband(self, team: str) -> bool:
        _named(team)
        members = self._members.pop(team, None)
        if members is None:
            return False
        for name in members:
            self._teams_of[name].discard(team)
        self._last_on_call.pop(team, None)
        return True

    def teamsOf(self, name: str) -> list[str]:
        _named(name)
        if name not in self._teams_of:
            raise ValueError("unknown engineer")
        return sorted(self._teams_of[name])

    # The extension round: the next on call, in join order.
    def rotate(self, team: str) -> str:
        _named(team)
        members = self._members.get(team)
        if not members:
            raise ValueError("unknown team or no members")
        nxt = (self._last_on_call.get(team, -1) + 1) % len(members)
        self._last_on_call[team] = nxt
        return members[nxt]
