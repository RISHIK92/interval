from __future__ import annotations

from collections.abc import Callable
from typing import Protocol


class Rule(Protocol):
    """One check over one line. The linter only knows this, so a new rule is a new class
    and an entry in RULES, and no existing rule or the linter itself is edited."""

    def flags(self, line: str) -> bool: ...


def _unused(param: int) -> None:
    if param != 0:
        raise ValueError("this rule takes no parameter")


class MaxLineLength:
    def __init__(self, param: int) -> None:
        if param < 1:
            raise ValueError("a maximum is at least 1")
        self._limit = param

    def flags(self, line: str) -> bool:
        return len(line) > self._limit


class NoTabs:
    def __init__(self, param: int) -> None:
        _unused(param)

    def flags(self, line: str) -> bool:
        return "\t" in line


class NoTrailingSpaces:
    def __init__(self, param: int) -> None:
        _unused(param)

    def flags(self, line: str) -> bool:
        return line.endswith(" ")


RULES: dict[str, Callable[[int], Rule]] = {
    "max-line-length": MaxLineLength,
    "no-tabs": NoTabs,
    "no-trailing-spaces": NoTrailingSpaces,
}


class BannedWords:
    """The extension round's rule: written and added without touching the ones above."""

    def __init__(self) -> None:
        self.words: set[str] = set()

    def flags(self, line: str) -> bool:
        return any(word in line for word in self.words)


class Linter:
    def __init__(self) -> None:
        self._rules: dict[str, Rule] = {}
        self._banned: BannedWords | None = None

    def enable(self, rule: str, param: int) -> None:
        made = RULES.get(rule)
        if made is None:
            raise ValueError("unknown rule")
        self._rules[rule] = made(param)

    def lint(self, lines: list[str]) -> list[str]:
        names = sorted(self._rules)
        return [
            f"{number}:{name}"
            for number, line in enumerate(lines, start=1)
            for name in names
            if self._rules[name].flags(line)
        ]

    def enabled(self) -> list[str]:
        return sorted(self._rules)

    # The extension round: one more rule, added beside the others.
    def banWord(self, word: str) -> None:
        if word == "":
            raise ValueError("empty word")
        if self._banned is None:
            self._banned = BannedWords()
            self._rules["ban-word"] = self._banned
        self._banned.words.add(word)
