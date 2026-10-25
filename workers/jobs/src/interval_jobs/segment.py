"""Split one stored full-text item into moments at its headings (ING-4, §3.2).

A moment is a deep link into the publisher's page, never a copy: the heading's anchor,
else a text fragment, else the top of the page. Merge and split rules for the 2-8 minute
target come in P1-W3-S03. Works through ports (ADR-0012); the caller owns the unit
of work.
"""

import math
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


def plan_moments(title: str, url: str, sections: list[SectionRow]) -> list[MomentRow]:
    if not any(s.heading and s.word_count for s in sections):
        return []  # no headings with content: whole article only (Q-P1-06)
    rows: list[MomentRow] = []
    for section in sections:
        if section.word_count == 0:
            continue  # e.g. the page title heading with nothing under it
        if section.heading is None:
            link, link_type = url.split("#", 1)[0], "page_top"
            name = title[:TITLE_MAX_CHARS]
        else:
            link, link_type = _link(url, section)
            name = section.heading
        rows.append(
            MomentRow(
                ordinal=len(rows),
                title=name,
                estimated_minutes=minutes(section.word_count),
                link=link,
                link_type=link_type,
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
    return rows
