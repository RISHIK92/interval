"""Heading sections grouped into 2 to 8 minute units (ING-4 rules, Q-P1-06), for book
sessions (P2-W11-S02). Articles are no longer split (ADR-0058).

The rules:
- a unit is a heading plus the subsections under it;
- one over 8 minutes splits at its next lower heading level; with none it stays one
  unit (never split mid-paragraph, so never inside a code block);
- a part under 2 minutes merges into its next sibling, or its previous one when it is
  last, until it reaches 2 minutes, but never past 8;
- the intro (text before the first heading) is always its own unit, however short.

"Under 2 minutes" is under 460 words: a 231-459 word part shows as 2 minutes (minutes
round up) yet still merges.
"""

import math
from dataclasses import dataclass, field

from interval_jobs.ports import SectionRow

WORDS_PER_MINUTE = 230  # Q-P1-06; code counts at the same rate


def minutes(words: int) -> int:
    return max(1, math.ceil(words / WORDS_PER_MINUTE))


MIN_WORDS = 2 * WORDS_PER_MINUTE
MAX_WORDS = 8 * WORDS_PER_MINUTE


@dataclass
class _Node:
    section: SectionRow
    children: list["_Node"] = field(default_factory=list["_Node"])

    def words(self) -> int:
        return self.section.word_count + sum(c.words() for c in self.children)

    def flat(self) -> list[SectionRow]:
        return [self.section, *(s for c in self.children for s in c.flat())]


def _tree(sections: list[SectionRow]) -> list[_Node]:
    """Top-level sections, each holding the deeper-level sections that follow it."""
    roots: list[_Node] = []
    open_nodes: list[_Node] = []
    for section in sections:
        node = _Node(section)
        level = section.level
        while open_nodes and not _deeper(level, open_nodes[-1].section.level):
            open_nodes.pop()
        (open_nodes[-1].children if open_nodes else roots).append(node)
        if section.heading is not None:  # the intro holds nothing under it
            open_nodes.append(node)
    return roots


def _deeper(level: int | None, parent: int | None) -> bool:
    # A heading of unknown level never nests, and nothing nests under one.
    return level is not None and parent is not None and level > parent


def _units(node: _Node) -> list[list[SectionRow]]:
    if node.words() <= MAX_WORDS or not node.children:
        return [node.flat()]
    # The section's own text and its subsections are siblings at the next level down.
    parts = [[node.section], *(u for child in node.children for u in _units(child))]
    return _merge_short(parts)


def _words(unit: list[SectionRow]) -> int:
    return sum(s.word_count for s in unit)


def _merge_short(units: list[list[SectionRow]]) -> list[list[SectionRow]]:
    merged = list(units)
    while True:
        for i, unit in enumerate(merged):
            if _words(unit) >= MIN_WORDS:
                continue
            after = merged[i + 1] if i + 1 < len(merged) else None
            before = merged[i - 1] if i > 0 else None
            if after is not None and _words(unit) + _words(after) <= MAX_WORDS:
                merged[i : i + 2] = [unit + after]
                break
            if before is not None and _words(before) + _words(unit) <= MAX_WORDS:
                merged[i - 1 : i + 1] = [before + unit]
                break
        else:
            return merged  # nothing short can merge without passing 8 minutes


def plan_units(sections: list[SectionRow]) -> list[list[SectionRow]]:
    """Sections grouped into 2 to 8 minute units (ING-4): the intro alone, then each
    heading with what's under it, split at its subheadings when too long and merged
    with a neighbour when too short (book sessions, P2-W11-S02)."""
    roots = _tree(sections)
    intro = [[r.section] for r in roots if r.section.heading is None]
    headed = [u for r in roots if r.section.heading is not None for u in _units(r)]
    return intro + _merge_short(headed)
