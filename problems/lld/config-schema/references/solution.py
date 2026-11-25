from __future__ import annotations

from abc import ABC, abstractmethod

DIGITS = "0123456789"


def _is_int(text: str) -> bool:
    digits = text[1:] if text.startswith("-") else text
    return 1 <= len(digits) <= 15 and all(c in DIGITS for c in digits)


class Rule(ABC):
    """One check on one field's value; None when the field is absent."""

    @abstractmethod
    def violation(self, value: str | None) -> str | None: ...


class Required(Rule):
    def violation(self, value: str | None) -> str | None:
        return "missing" if value is None else None


class IntRange(Rule):
    def __init__(self, low: int, high: int) -> None:
        self.low = low
        self.high = high

    def violation(self, value: str | None) -> str | None:
        if value is None:
            return None
        if not _is_int(value):
            return "not an integer"
        if not self.low <= int(value) <= self.high:
            return "out of range"
        return None


class OneOf(Rule):
    def __init__(self, items: list[str]) -> None:
        self.items = items

    def violation(self, value: str | None) -> str | None:
        if value is None or value in self.items:
            return None
        return "not allowed"


def _parse(spec: str) -> Rule:
    if spec == "required":
        return Required()
    kind, _, rest = spec.partition(":")
    if kind == "int":
        bounds = rest.split(":")
        if len(bounds) == 2 and all(_is_int(b) for b in bounds) and int(bounds[0]) <= int(bounds[1]):
            return IntRange(int(bounds[0]), int(bounds[1]))
    elif kind == "oneOf":
        items = rest.split(",")
        if "" not in items:
            return OneOf(items)
    raise ValueError("unknown spec")


class ConfigSchema:
    def __init__(self) -> None:
        self._rules: dict[str, list[Rule]] = {}
        self._fallbacks: dict[str, str] = {}

    def rule(self, field: str, spec: str) -> None:
        parsed = _parse(spec)
        if field == "" or isinstance(parsed, Required) and field in self._fallbacks:
            raise ValueError("a field name is never empty, and this field can't take this rule")
        self._rules.setdefault(field, []).append(parsed)

    def check(self, env: dict[str, str]) -> list[str]:
        out: list[str] = []
        for field in sorted(self._rules):
            value = env.get(field, self._fallbacks.get(field))
            for rule in self._rules[field]:
                problem = rule.violation(value)
                if problem is not None:
                    out.append(f"{field}: {problem}")
        return out

    def fields(self) -> list[str]:
        return sorted(self._rules)

    # The extension round.
    def fallback(self, field: str, value: str) -> None:
        rules = self._rules.get(field, [])
        if rules == [] or any(isinstance(r, Required) for r in rules):
            raise ValueError("a fallback needs a field with rules and none required")
        self._fallbacks[field] = value
