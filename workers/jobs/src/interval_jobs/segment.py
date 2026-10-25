"""Split one stored full-text item into moments at its headings (ING-4, §3.2).

A moment is a deep link into the publisher's page, never a copy: the heading's anchor,
else a text fragment, else the top of the page. Works through ports (ADR-0012); the
caller owns the unit of work.

The 2-8 minute rules (Q-P1-06, P1-W3-S03):
- a section is its heading plus the subsections under it;
- one over 8 minutes splits at its next lower heading level; with none it stays one
  moment, flagged oversized (never split mid-paragraph, so never inside a code block);
- a part under 2 minutes merges into its next sibling, or its previous one when it is
  last, until it reaches 2 minutes, but never past 8; the merged moment links to its
  first heading;
- the intro (text before the first heading) is always its own moment, linked to the top
  of the page, however short (owner, 2026-10-25; the tension with the 2-minute rule is
  in docs/conflicts.md).
"Under 2 minutes" is under 460 words: a 231-459 word part shows as 2 minutes (minutes
round up) yet still merges.
"""

import math
from dataclasses import dataclass, field
from urllib.parse import quote

from interval_db.generated import MomentLinkType
from interval_jobs.ports import MomentRow, SectionRow, Store
from interval_jobs.rights import allowed

WORDS_PER_MINUTE = 230  # Q-P1-06; code counts at the same rate
TITLE_MAX_CHARS = 300  # moment.title check constraint


def minutes(words: int) -> int:
    return max(1, math.ceil(words / WORDS_PER_MINUTE))


def text_fragment(heading: str) -> str:
    # URL Fragment Text Directives: '-', '&' and ',' are syntax and must be encoded.
    return "#:~:text=" + quote(heading, safe="").replace("-", "%2D")


# Two headings with the same text and no id get the same text fragment, which resolves
# to the first occurrence. Disambiguating needs prefix/suffix context from the body
# text, which a moment must not store (§3.2), so the duplicate link is accepted.
def _link(url: str, section: SectionRow) -> tuple[str, MomentLinkType]:
    base = url.split("#", 1)[0]
    if section.anchor_id:
        return f"{base}#{quote(section.anchor_id, safe='-._~')}", "anchor"
    if section.heading:
        return base + text_fragment(section.heading), "text_fragment"
    return base, "page_top"


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


def plan_moments(title: str, url: str, sections: list[SectionRow]) -> list[MomentRow]:
    if not any(s.heading and s.word_count for s in sections):
        return []  # no headings with content: whole article only (Q-P1-06)
    roots = _tree(sections)
    intro = [[r.section] for r in roots if r.section.heading is None]
    headed = [u for r in roots if r.section.heading is not None for u in _units(r)]
    rows: list[MomentRow] = []
    for unit in intro + _merge_short(headed):
        words = _words(unit)
        if words == 0:
            continue  # e.g. the page title heading with nothing under it
        first = unit[0]
        if first.heading is None:
            link, link_type = url.split("#", 1)[0], "page_top"
            name = title[:TITLE_MAX_CHARS]
        else:
            link, link_type = _link(url, first)
            name = first.heading
        rows.append(
            MomentRow(
                ordinal=len(rows),
                title=name,
                estimated_minutes=minutes(words),
                link=link,
                link_type=link_type,
                oversized=words > MAX_WORDS,
            )
        )
    return rows


def segment_item(store: Store, content_item_id: int) -> list[MomentRow]:
    item = store.items.for_segmentation(content_item_id)
    if item is None:
        raise LookupError(f"no content item with id {content_item_id}")

    rows: list[MomentRow] = []
    if item.moments_enabled and allowed(item.rights_profile, "make_moments"):
        sections = store.items.sections(content_item_id)
        rows = plan_moments(item.title, item.canonical_url, sections)

    # Upserted by ordinal so a moment keeps its id across runs (saves, history and
    # events will reference it); ordinals no longer produced are removed.
    store.moments.replace(content_item_id, rows)
    # Moment ids are kept by ordinal, but their text may have changed: tags and
    # vectors made for the old moments would mislead, so they are redone.
    store.tags.clear(content_item_id)
    store.embeddings.clear(content_item_id)
    return rows
