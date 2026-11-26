from __future__ import annotations

ANY = "*"
USER = "{user}"
NO_MATCH = "no-match"
SIMULATED = "(new)"
HOURS = 24


def _named(*names: str) -> None:
    if "" in names:
        raise ValueError("an empty name")


def _hour_part(text: str) -> int:
    if len(text) > 2 or not (text.isascii() and text.isdigit()):
        raise ValueError("an hour is one or two digits")
    return int(text)


class Glob:
    """A resource pattern: literal characters, `*` for any run of characters, and
    `{user}` for the requesting user's name, matched literally."""

    def __init__(self, text: str) -> None:
        self.parts: list[str] = []  # each part is one literal character, ANY or USER
        for k, chunk in enumerate(text.split(USER)):
            if k > 0:
                self.parts.append(USER)
            for char in chunk:
                if char in "{}":
                    raise ValueError("a brace outside {user}")
                self.parts.append(char)

    def matches(self, resource: str, user: str) -> bool:
        items: list[str | None] = []  # None for ANY, otherwise one literal character
        for part in self.parts:
            if part == USER:
                items += list(user)
            else:
                items.append(None if part == ANY else part)
        # reach[j]: the items so far can match the first j characters.
        reach = [True] + [False] * len(resource)
        for item in items:
            nxt: list[bool] = []
            for j in range(len(resource) + 1):
                if item is None:
                    nxt.append(reach[j] or (j > 0 and nxt[j - 1]))
                else:
                    nxt.append(j > 0 and reach[j - 1] and resource[j - 1] == item)
            reach = nxt
        return reach[len(resource)]


class Policy:
    """One parsed rule. A request it matches is decided by its effect."""

    def __init__(self, ident: str, text: str) -> None:
        words = [w for w in text.split(" ") if w]
        if len(words) not in (4, 6) or words[0] not in ("allow", "deny"):
            raise ValueError("effect role action resource [during from-to]")
        self.ident = ident
        self.effect, self.role, self.action = words[0], words[1], words[2]
        self.resource = Glob(words[3])
        self.hours: tuple[int, int] | None = None  # from, to (not included)
        if len(words) == 6:
            hours = words[5].split("-")
            if words[4] != "during" or len(hours) != 2:
                raise ValueError("during from-to")
            start, end = _hour_part(hours[0]), _hour_part(hours[1])
            if start >= end or end > HOURS:
                raise ValueError("hours run forward, up to 24")
            self.hours = (start, end)

    def matches(
        self, user: str, roles: list[str], action: str, resource: str, hour: int
    ) -> bool:
        return (
            (self.role == ANY or self.role in roles)
            and self.action in (ANY, action)
            and (self.hours is None or self.hours[0] <= hour < self.hours[1])
            and self.resource.matches(resource, user)
        )


class PolicyEngine:
    def __init__(self) -> None:
        self._policies: list[Policy] = []

    def addPolicy(self, id: str, text: str) -> bool:
        _named(id)
        policy = Policy(id, text)
        if any(p.ident == id for p in self._policies):
            return False
        self._policies.append(policy)
        return True

    def removePolicy(self, id: str) -> bool:
        _named(id)
        kept = [p for p in self._policies if p.ident != id]
        removed = len(kept) < len(self._policies)
        self._policies = kept
        return removed

    def decide(
        self, user: str, roles: list[str], action: str, resource: str, hour: int
    ) -> str:
        return self._decide(self._policies, user, roles, action, resource, hour)

    # The extension round: a decision as if one more policy existed.
    def simulate(
        self,
        text: str,
        user: str,
        roles: list[str],
        action: str,
        resource: str,
        hour: int,
    ) -> str:
        policies = [*self._policies, Policy(SIMULATED, text)]
        return self._decide(policies, user, roles, action, resource, hour)

    @staticmethod
    def _decide(
        policies: list[Policy],
        user: str,
        roles: list[str],
        action: str,
        resource: str,
        hour: int,
    ) -> str:
        _named(user, action, resource, *roles)
        if hour < 0 or hour >= HOURS:
            raise ValueError("an hour runs from 0 to 23")
        # A chain of responsibility in two passes: any deny that matches decides first,
        # then the earliest allow; with neither, the request falls off the chain.
        for effect in ("deny", "allow"):
            for p in policies:
                if p.effect == effect and p.matches(
                    user, roles, action, resource, hour
                ):
                    return f"{effect}:{p.ident}"
        return NO_MATCH
