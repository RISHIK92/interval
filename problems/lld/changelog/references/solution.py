from __future__ import annotations

import re
from typing import NamedTuple

# Parsing, grouping and rendering are three units with one reason to change each: a new
# message syntax touches only the parser, a new section only the grouper, a new layout
# only the renderer. Changelog just keeps the commits and wires the three together.

HEADER = re.compile(r"([a-z]+)(?:\(([^()]+)\))?(!?): (.+)")


class Entry(NamedTuple):
    sha: str
    kind: str
    scope: str | None
    breaking: bool
    description: str


def parse(sha: str, message: str) -> Entry | None:
    found = HEADER.fullmatch(message)
    if found is None:
        return None
    kind, scope, bang, description = found.groups()
    return Entry(sha, kind, scope, bang == "!", description)


SECTIONS = {"feat": "Features", "fix": "Fixes"}
OTHER = "Other"


def group(entries: list[Entry], breaking_first: bool) -> list[tuple[str, list[Entry]]]:
    titles = (["BREAKING"] if breaking_first else []) + [*SECTIONS.values(), OTHER]
    sections: dict[str, list[Entry]] = {title: [] for title in titles}
    for entry in entries:
        if breaking_first and entry.breaking:
            sections["BREAKING"].append(entry)
        else:
            sections[SECTIONS.get(entry.kind, OTHER)].append(entry)
    return [(title, listed) for title, listed in sections.items() if listed]


def render(version: str, sections: list[tuple[str, list[Entry]]]) -> list[str]:
    lines = [f"## {version}"]
    for title, entries in sections:
        lines.append(f"### {title}")
        for entry in entries:
            scope = "" if entry.scope is None else f"{entry.scope}: "
            lines.append(f"- {scope}{entry.description} ({entry.sha[:7]})")
    return lines


def _given(value: str) -> None:
    if value == "":
        raise ValueError("empty")


class Changelog:
    def __init__(self) -> None:
        self._pending: list[Entry] = []
        self._shas: set[str] = set()
        self._versions: set[str] = set()
        self._breaking_first = False

    def commit(self, sha: str, message: str) -> bool:
        _given(sha)
        _given(message)
        entry = parse(sha, message)
        if entry is None or sha in self._shas:
            return False
        self._shas.add(sha)
        self._pending.append(entry)
        return True

    def release(self, version: str) -> list[str]:
        _given(version)
        if version in self._versions:
            raise ValueError("already released")
        if not self._pending:
            raise ValueError("nothing to release")
        lines = render(version, group(self._pending, self._breaking_first))
        self._versions.add(version)
        self._pending = []
        return lines

    def unreleased(self) -> int:
        return len(self._pending)

    # The extension round: one more grouping rule, and only the grouper hears about it.
    def breakingSection(self, on: bool) -> None:
        self._breaking_first = on
