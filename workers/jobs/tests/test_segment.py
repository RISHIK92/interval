"""Segmentation logic on in-memory ports (ADR-0012). ING-4, §3.2, Q-P1-06."""

import pytest

from interval_db.generated import RightsProfile
from interval_jobs.adapters.memory import InMemoryStore
from interval_jobs.ports import SectionRow
from interval_jobs.segment import minutes, plan_moments, segment_item

from .support import ARTICLE_URL, ingest_fake


def moments(store: InMemoryStore, item_id: int) -> list[tuple[int, str, int, str, str]]:
    return [
        (
            m.row.ordinal,
            m.row.title,
            m.row.estimated_minutes,
            m.row.link,
            m.row.link_type,
        )
        for m in store.moments.for_item(item_id)
    ]


def test_headings_with_ids_become_anchor_moments_after_a_page_top_intro() -> None:
    sections = [
        SectionRow(None, None, 600, None),
        SectionRow("Setup", "setup", 600, 2),
        SectionRow("Log shipping", "log-shipping", 600, 2),
        SectionRow("Plain heading", None, 600, 2),
    ]
    got = plan_moments("Title", ARTICLE_URL + "#old", sections)
    assert [m.ordinal for m in got] == [0, 1, 2, 3]
    assert [(m.title, m.link, m.link_type) for m in got] == [
        ("Title", ARTICLE_URL, "page_top"),
        ("Setup", f"{ARTICLE_URL}#setup", "anchor"),
        ("Log shipping", f"{ARTICLE_URL}#log-shipping", "anchor"),
        ("Plain heading", f"{ARTICLE_URL}#:~:text=Plain%20heading", "text_fragment"),
    ]


def test_headings_without_ids_get_encoded_text_fragment_links() -> None:
    sections = [
        SectionRow("Leaders & followers", None, 600, 2),
        SectionRow("Quorum, reads-writes", None, 600, 2),
    ]
    links = [m.link for m in plan_moments("Title", ARTICLE_URL, sections)]
    assert links == [
        f"{ARTICLE_URL}#:~:text=Leaders%20%26%20followers",
        f"{ARTICLE_URL}#:~:text=Quorum%2C%20reads%2Dwrites",
    ]


def test_minutes_round_up_with_a_minimum_of_one() -> None:
    assert [minutes(w) for w in (0, 1, 230, 231, 461)] == [1, 1, 1, 2, 3]


def test_short_sections_merge_after_an_intro_that_stays_its_own_moment() -> None:
    # The fixture's headed sections (68 + 248 + 68 + 34 + 34 words) are each under two
    # minutes and merge into one moment at the first heading; the 34-word intro stays
    # its own moment (owner, 2026-10-25).
    store, _, item_id = ingest_fake("article_mixed.html")
    assert moments(store, item_id) == [
        (0, "How our write-ahead log works", 1, ARTICLE_URL, "page_top"),
        (1, "Setup", 2, f"{ARTICLE_URL}#setup", "anchor"),
    ]


def test_article_without_headings_gets_no_moments() -> None:
    store, _, item_id = ingest_fake("article_no_headings.html")
    segment_item(store, item_id)
    assert moments(store, item_id) == []


def test_moments_switched_off_creates_none_and_removes_existing() -> None:
    store, source_id, item_id = ingest_fake("article.html")
    segment_item(store, item_id)
    assert moments(store, item_id) != []

    store.sources.set_moments_enabled(source_id, False)
    segment_item(store, item_id)
    assert moments(store, item_id) == []


@pytest.mark.parametrize("profile", ["metadata_only", "excerpt"])
def test_sources_without_internal_full_text_get_no_moments(
    profile: RightsProfile,
) -> None:
    store, _, item_id = ingest_fake("article.html", profile=profile)
    assert segment_item(store, item_id) == []
    assert moments(store, item_id) == []


def ids(store: InMemoryStore, item_id: int) -> list[int]:
    return [m.id for m in store.moments.for_item(item_id)]


def test_running_twice_gives_the_same_moments_with_the_same_ids() -> None:
    store, _, item_id = ingest_fake("article_long.html")
    assert len(ids(store, item_id)) == 3
    first, first_ids = moments(store, item_id), ids(store, item_id)
    segment_item(store, item_id)
    assert moments(store, item_id) == first
    assert ids(store, item_id) == first_ids


def test_ingest_segments_and_reingest_with_new_html_replaces_the_moments() -> None:
    store, _, item_id = ingest_fake("article_long.html")
    assert len(moments(store, item_id)) == 3

    _, _, again = ingest_fake("article_v2.html", store=store)
    assert again == item_id
    # Three moments become two: the third ordinal is removed.
    assert [(m[0], m[1]) for m in moments(store, item_id)] == [
        (0, "How our write-ahead log works"),
        (1, "Only section"),
    ]

    _, _, again = ingest_fake("article_no_headings.html", store=store)
    assert moments(store, item_id) == []


def test_headings_without_content_give_no_moments() -> None:
    sections = [SectionRow(heading=None, anchor_id=None, word_count=300, level=None)]
    sections.append(SectionRow(heading="Empty", anchor_id="e", word_count=0, level=2))
    assert plan_moments("T", "https://a.example.test/p", sections) == []


# P1-W3-S03: the 2-8 minute rules (Q-P1-06), one test per rule. 230 words a minute:
# under 460 words is under 2 minutes, over 1840 is over 8.
URL = "https://a.example.test/p"


def h(heading: str, words: int, level: int = 2) -> SectionRow:
    return SectionRow(heading, heading.lower(), words, level)


def plan(*sections: SectionRow) -> list[tuple[str, int, bool]]:
    return [
        (m.title, m.estimated_minutes, m.oversized)
        for m in plan_moments("Title", URL, list(sections))
    ]


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
    moments = plan_moments(
        "Title",
        URL,
        [h("A", 50), h("A1", 1000, level=3), h("A2", 1000, level=3), h("B", 600)],
    )
    assert [(m.title, m.estimated_minutes) for m in moments] == [
        ("A", 5),  # A's own 50 words are too short alone: they lead into A1
        ("A2", 5),
        ("B", 3),
    ]
    assert moments[0].link == f"{URL}#a"


def test_a_long_section_without_subheadings_is_one_oversized_moment() -> None:
    # Never split mid-paragraph: that would need a link into arbitrary text.
    assert plan(h("A", 2000), h("B", 600)) == [("A", 9, True), ("B", 3, False)]


def test_a_code_heavy_section_counts_code_as_prose_and_is_never_cut() -> None:
    # 40 prose words + 1900 code tokens under one heading, no subheading: one moment,
    # code counted at the prose rate (Q-P1-06), flagged oversized, never cut.
    store, _, item_id = ingest_fake("article_code.html")
    got = [
        (m.row.title, m.row.estimated_minutes, m.row.oversized)
        for m in store.moments.for_item(item_id)
    ]
    assert got == [
        ("How our write-ahead log works", 3, False),
        ("Listing", 9, True),
        ("After", 3, False),
    ]


def test_a_short_intro_is_still_its_own_moment() -> None:
    # Owner, 2026-10-25: text before the first heading is its own moment.
    intro = SectionRow(None, None, 100, None)
    moments = plan_moments("Title", URL, [intro, h("A", 600)])
    assert [(m.title, m.estimated_minutes, m.link_type) for m in moments] == [
        ("Title", 1, "page_top"),
        ("A", 3, "anchor"),
    ]


def test_a_long_intro_is_its_own_moment() -> None:
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


def test_a_merge_never_takes_a_moment_past_eight_minutes() -> None:
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
    # A "Part 2" banner with nothing under it: its moment starts there.
    assert plan(h("A", 600), h("Part 2", 0), h("B", 600)) == [
        ("A", 3, False),
        ("Part 2", 3, False),
    ]


def test_a_huge_intro_is_one_oversized_moment_at_the_top() -> None:
    intro = SectionRow(None, None, 2000, None)
    assert plan(intro, h("A", 600)) == [("Title", 9, True), ("A", 3, False)]


# P1-W3-S05: an admin's boundaries replace the 2-8 minute rules for that item.
def test_admin_boundaries_start_moments_exactly_at_their_headings() -> None:
    intro = SectionRow(None, None, 100, None)
    sections = [intro, h("A", 300), h("A1", 300, 3), h("B", 2000), h("C", 50)]
    moments = plan_moments("Title", URL, sections, boundaries=["a1", "  C "])
    assert [(m.title, m.estimated_minutes, m.oversized) for m in moments] == [
        ("Title", 1, False),  # the intro stays its own moment
        ("A", 2, False),  # headings before the first boundary keep their own start
        ("A1", 10, True),  # A1 + B, 2300 words, over 8 minutes: still flagged
        ("C", 1, False),  # a short moment the admin asked for
    ]


def test_boundaries_naming_no_heading_fall_back_to_the_rules_and_say_so(
    capsys: pytest.CaptureFixture[str],
) -> None:
    sections = [h("A", 600), h("B", 600)]
    assert plan_moments("T", URL, sections, boundaries=["gone"]) == plan_moments(
        "T", URL, sections
    )
    assert "segment: admin boundaries not in the item" in capsys.readouterr().out


def test_a_repeated_heading_starts_a_moment_at_every_occurrence() -> None:
    # Boundaries are kept by heading text (they must survive re-ingestion), so two
    # "Example" sections can't be told apart: a known limit.
    sections = [h("A", 600), h("Example", 300), h("B", 600), h("Example", 300)]
    assert [m.title for m in plan_moments("T", URL, sections, ["Example"])] == [
        "A",
        "Example",
        "Example",
    ]


def test_segmenting_uses_the_stored_boundaries() -> None:
    store, _, item_id = ingest_fake("article_long.html")
    store.items.boundary_overrides[item_id] = ["Beta part"]
    segment_item(store, item_id)
    assert [m[1] for m in moments(store, item_id)] == [
        "How our write-ahead log works",
        "Alpha",
        "Beta part",
    ]
    store.items.boundary_overrides[item_id] = ["Alpha"]
    segment_item(store, item_id)
    assert [(m[1], m[2]) for m in moments(store, item_id)] == [
        ("How our write-ahead log works", 3),
        ("Alpha", 6),
    ]
