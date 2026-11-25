from __future__ import annotations

DIGITS = set("0123456789")


def _filled(text: str) -> str:
    if text == "":
        raise ValueError("empty")
    return text


def bucket(flag: str, user: str) -> int:
    """The user's bucket for this flag, 0 to 99: a hash, so it's stable across calls and
    clients, and different flags split users differently."""
    h = 0
    for c in flag + ":" + user:
        h = (h * 31 + ord(c)) % 1000003
    return h % 100


# The adapter side: each rule string from the server becomes a small rule object.
class UserRule:
    def __init__(self, name: str) -> None:
        self.name = _filled(name)

    def matches(self, flag: str, user: str, attrs: dict[str, str]) -> bool:
        return user == self.name


class AttrRule:
    def __init__(self, text: str) -> None:
        key, eq, value = text.partition("=")
        if not eq:
            raise ValueError("attr:<key>=<value>")
        self.key = _filled(key)
        self.value = _filled(value)

    def matches(self, flag: str, user: str, attrs: dict[str, str]) -> bool:
        return attrs.get(self.key) == self.value


class PercentRule:
    def __init__(self, text: str) -> None:
        if text == "" or any(c not in DIGITS for c in text) or text != str(int(text)):
            raise ValueError("a percentage is a plain number")
        self.percent = int(text)
        if self.percent > 100:
            raise ValueError("at most 100%")

    def matches(self, flag: str, user: str, attrs: dict[str, str]) -> bool:
        return bucket(flag, user) < self.percent


RULES = {"user": UserRule, "attr": AttrRule, "percent": PercentRule}
Rule = UserRule | AttrRule | PercentRule


def _rule(text: str) -> Rule:
    # A rule without a ":" leaves nothing for the rule itself, and every rule needs it.
    kind, _, rest = text.partition(":")
    if kind not in RULES:
        raise ValueError("an unknown rule")
    return RULES[kind](rest)


class FlagClient:
    """The facade: evaluate hides fetching, the local copy of the rules (a proxy for the
    flag server) and the rule types. Until a sync reaches the server it answers with the
    defaults; while the server is down it keeps answering from its last copy."""

    def __init__(self, defaults: dict[str, bool]) -> None:
        for flag in defaults:
            _filled(flag)
        self._defaults = dict(defaults)
        self._server: dict[str, tuple[list[Rule], int]] = {}
        self._copy: dict[str, list[Rule]] = {}
        self._synced_at: int | None = None
        self._overrides: dict[str, bool] = {}

    def serverRules(self, flag: str, rules: list[str], version: int) -> None:
        _filled(flag)
        if version < 1:
            raise ValueError("versions start at 1")
        parsed = [_rule(text) for text in rules]
        current = self._server.get(flag)
        if current is None or version > current[1]:
            self._server[flag] = (parsed, version)

    def sync(self, nowMs: int, reachable: bool) -> bool:
        if not reachable:
            return False
        self._copy = {flag: rules for flag, (rules, _) in self._server.items()}
        self._synced_at = nowMs
        return True

    def evaluate(self, flag: str, user: str, attrs: dict[str, str]) -> bool:
        _filled(flag)
        _filled(user)
        if flag in self._overrides:
            return self._overrides[flag]
        if flag in self._copy:
            return any(rule.matches(flag, user, attrs) for rule in self._copy[flag])
        if flag not in self._defaults:
            raise KeyError("no rules and no default")
        return self._defaults[flag]

    def staleMs(self, nowMs: int) -> int:
        if self._synced_at is None:
            raise ValueError("never synced")
        return nowMs - self._synced_at

    # The extension round: a local override wins over everything else.
    def localOverride(self, flag: str, on: bool) -> None:
        self._overrides[_filled(flag)] = on
