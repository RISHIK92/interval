from __future__ import annotations

from abc import ABC, abstractmethod

# Which actions each role may take: the one table a new role is added to.
ROLES: dict[str, frozenset[str]] = {
    "viewer": frozenset({"read"}),
    "operator": frozenset({"read", "suspend", "restore"}),
    "admin": frozenset({"read", "suspend", "restore", "delete"}),
}
ACTIONS = frozenset({"read", "suspend", "restore", "delete"})


def _given(value: str) -> None:
    if value == "":
        raise ValueError("empty")


class AdminApi(ABC):
    """What callers see: the real API and its proxy answer the same call."""

    @abstractmethod
    def handle(self, user: str, action: str, target: str) -> str: ...


class RealAdminApi(AdminApi):
    """The real subject. It does whatever it's asked and knows nothing about roles."""

    def __init__(self) -> None:
        self.calls = 0
        self._suspended: set[str] = set()
        self._deleted: set[str] = set()

    def handle(self, user: str, action: str, target: str) -> str:
        self.calls += 1
        if target in self._deleted:
            return "404"
        if action == "suspend":
            if target in self._suspended:
                return "409"
            self._suspended.add(target)
        elif action == "restore":
            if target not in self._suspended:
                return "409"
            self._suspended.remove(target)
        elif action == "delete":
            self._deleted.add(target)
        return "200"


class AdminProxy(AdminApi):
    """A protection proxy: the same call as the real API, but it decides first whether
    the call may go through, and writes every attempt down. A call it stops never
    reaches the real API, which the API's own call count shows."""

    def __init__(self) -> None:
        self._api = RealAdminApi()
        self._roles: dict[str, set[str]] = {}
        self._audit: list[str] = []
        self._glass: set[str] = set()

    def grant(self, user: str, role: str) -> None:
        _given(user)
        if role not in ROLES:
            raise ValueError("unknown role")
        self._roles.setdefault(user, set()).add(role)

    def handle(self, user: str, action: str, target: str) -> str:
        # Who you are (authentication) comes before what you may do (authorization).
        roles = self._roles.get(user)
        if roles is None:
            return "401"
        if user in self._glass or any(action in ROLES[role] for role in roles):
            return self._api.handle(user, action, target)
        return "403"

    def invoke(self, user: str, action: str, target: str) -> str:
        _given(user)
        if action not in ACTIONS:
            raise ValueError("unknown action")
        _given(target)
        status = self.handle(user, action, target)
        line = f"{user} {action} {target} {status}"
        self._audit.append(f"{line} break-glass" if user in self._glass else line)
        return f"{status} {action} {target}"

    def audit(self) -> list[str]:
        return list(self._audit)

    def realCalls(self) -> int:
        return self._api.calls

    # The extension round: emergency access, marked in the audit.
    def breakGlass(self, user: str) -> bool:
        self._known(user)
        if user in self._glass:
            return False
        self._glass.add(user)
        return True

    def endBreakGlass(self, user: str) -> bool:
        self._known(user)
        if user not in self._glass:
            return False
        self._glass.remove(user)
        return True

    def _known(self, user: str) -> None:
        if user not in self._roles:
            raise ValueError("break-glass is for users with a grant")
