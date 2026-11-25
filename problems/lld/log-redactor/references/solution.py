from __future__ import annotations

from typing import Protocol

DIGITS = frozenset("0123456789")


class Rule(Protocol):
    """One kind of secret. Each rule rewrites the words it matches and counts them; the
    redactor only decides which rules run and in what order."""

    def apply(self, words: list[str]) -> int: ...


class Emails:
    def apply(self, words: list[str]) -> int:
        hits = 0
        for i, word in enumerate(words):
            local, _, domain = word.partition("@")
            if local and "@" not in domain and "." in domain[1:-1]:
                words[i] = "[email]"
                hits += 1
        return hits


class Cards:
    def apply(self, words: list[str]) -> int:
        hits = 0
        for i, word in enumerate(words):
            if 13 <= len(word) <= 19 and set(word) <= DIGITS:
                words[i] = "*" * (len(word) - 4) + word[-4:]
                hits += 1
        return hits


class AfterWord:
    """Masks the word that comes right after a given word, left to right."""

    def __init__(self, prefix: str, mask: str) -> None:
        self._prefix = prefix
        self._mask = mask

    def apply(self, words: list[str]) -> int:
        hits = 0
        for i in range(len(words) - 1):
            if words[i] == self._prefix and words[i + 1] != "":
                words[i + 1] = self._mask
                hits += 1
        return hits


class Redactor:
    def __init__(self) -> None:
        self._rules: dict[str, Rule] = {
            "email": Emails(),
            "card": Cards(),
            "bearer": AfterWord("Bearer", "[token]"),
        }
        self._enabled: list[str] = []
        self._hits: dict[str, int] = dict.fromkeys(self._rules, 0)

    def _known(self, rule: str) -> str:
        if rule not in self._rules:
            raise ValueError("unknown rule")
        return rule

    def enable(self, rule: str) -> None:
        if self._known(rule) not in self._enabled:
            self._enabled.append(rule)

    def disable(self, rule: str) -> None:
        if self._known(rule) in self._enabled:
            self._enabled.remove(rule)

    def redact(self, line: str) -> str:
        words = line.split(" ")
        for name in self._enabled:
            self._hits[name] += self._rules[name].apply(words)
        return " ".join(words)

    def hits(self, rule: str) -> int:
        return self._hits[self._known(rule)]

    # The extension round: a new rule is one more entry, run like any other.
    def maskAfter(self, name: str, prefix: str) -> None:
        if name == "" or name in self._rules:
            raise ValueError("a rule needs a new, non-empty name")
        if prefix == "" or " " in prefix:
            raise ValueError("the prefix is one word")
        self._rules[name] = AfterWord(prefix, f"[{name}]")
        self._hits[name] = 0
