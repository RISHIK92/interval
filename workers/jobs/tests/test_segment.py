"""Heading sections grouped into 2 to 8 minute units (ING-4 rules, Q-P1-06), as book
sessions are cut (P2-W11-S02). Articles are no longer split (ADR-0058). 230 words a
minute: under 460 words is under 2 minutes, over 1840 is over 8."""

from interval_jobs.ports import SectionRow
from interval_jobs.segment import MAX_WORDS, minutes, plan_units


def test_minutes_round_up_with_a_minimum_of_one() -> None:
    assert [minutes(w) for w in (0, 1, 230, 231, 461)] == [1, 1, 1, 2, 3]


def h(heading: str, words: int, level: int = 2) -> SectionRow:
    return SectionRow(heading, heading.lower(), words, level)


def plan(*sections: SectionRow) -> list[tuple[str, int, bool]]:
    """Each unit as (its first heading, or "Title" for the intro; minutes; over 8)."""
    out: list[tuple[str, int, bool]] = []
    for unit in plan_units(list(sections)):
        words = sum(s.word_count for s in unit)
        out.append((unit[0].heading or "Title", minutes(words), words > MAX_WORDS))
    return out


def test_a_section_under_two_minutes_merges_into_the_next() -> None:
    assert plan(h("A", 600), h("B", 100), h("C", 600)) == [
        ("A", 3, False),
        ("B", 4, False),  # B + C, linked at B
    ]


def test_a_short_last_section_merges_into_the_previous() -> None:
    assert plan(h("A", 600), h("B", 600), h("C", 100)) == [
        ("A", 3, False),
        ("B", 4, False),
    ]


def test_merging_stops_once_two_minutes_are_reached() -> None:
    assert plan(h("A", 100), h("B", 100), h("C", 300), h("D", 600)) == [
        ("A", 3, False),  # A + B + C = 500 words
        ("D", 3, False),
    ]


def test_subsections_stay_with_their_section_while_it_fits() -> None:
    assert plan(h("A", 300), h("A1", 300, level=3), h("B", 600)) == [
        ("A", 3, False),
        ("B", 3, False),
    ]


def test_a_section_over_eight_minutes_splits_at_its_subheadings() -> None:
    assert plan(
        h("A", 50), h("A1", 1000, level=3), h("A2", 1000, level=3), h("B", 600)
    ) == [
        ("A", 5, False),  # A's own 50 words are too short alone: they lead into A1
        ("A2", 5, False),
        ("B", 3, False),
    ]


def test_a_long_section_without_subheadings_is_one_oversized_unit() -> None:
    # Never split mid-paragraph: that would need a link into arbitrary text.
    assert plan(h("A", 2000), h("B", 600)) == [("A", 9, True), ("B", 3, False)]


def test_a_short_intro_is_still_its_own_unit() -> None:
    # Owner, 2026-10-25: text before the first heading is its own unit.
    intro = SectionRow(None, None, 100, None)
    assert plan(intro, h("A", 600)) == [("Title", 1, False), ("A", 3, False)]


def test_a_long_intro_is_its_own_unit() -> None:
    intro = SectionRow(None, None, 600, None)
    assert plan(intro, h("A", 600)) == [("Title", 3, False), ("A", 3, False)]


def test_short_parts_merge_within_their_section_not_into_the_next() -> None:
    # A is over 8 minutes, so it splits; its short last part A2 merges back into A1
    # rather than across into B.
    assert plan(h("A", 600), h("A1", 1300, 3), h("A2", 100, 3), h("B", 600)) == [
        ("A", 3, False),
        ("A1", 7, False),
        ("B", 3, False),
    ]


def test_a_merge_never_takes_a_unit_past_eight_minutes() -> None:
    assert plan(h("A", 400), h("B", 1800)) == [("A", 2, False), ("B", 8, False)]


def test_the_two_and_eight_minute_edges() -> None:
    assert plan(h("A", 459), h("B", 600)) == [("A", 5, False)]
    assert plan(h("A", 460), h("B", 600)) == [("A", 2, False), ("B", 3, False)]
    assert plan(h("A", 1840)) == [("A", 8, False)]
    assert plan(h("A", 1841)) == [("A", 9, True)]


def test_a_skipped_heading_level_still_nests() -> None:
    assert plan(h("A", 1000), h("A1", 1000, 4), h("B", 600)) == [
        ("A", 5, False),
        ("A1", 5, False),
        ("B", 3, False),
    ]


def test_a_heading_of_unknown_level_stands_alone() -> None:
    x = SectionRow("X", "x", 500, None)
    assert plan(h("A", 500), x, h("A1", 500, 3)) == [
        ("A", 3, False),
        ("X", 3, False),
        ("A1", 3, False),
    ]


def test_an_empty_heading_leads_into_the_next_section() -> None:
    # A "Part 2" banner with nothing under it: its unit starts there.
    assert plan(h("A", 600), h("Part 2", 0), h("B", 600)) == [
        ("A", 3, False),
        ("Part 2", 3, False),
    ]


def test_a_huge_intro_is_one_oversized_unit_at_the_top() -> None:
    intro = SectionRow(None, None, 2000, None)
    assert plan(intro, h("A", 600)) == [("Title", 9, True), ("A", 3, False)]
