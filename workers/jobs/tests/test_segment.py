"""Segmentation logic on in-memory ports (ADR-0012). ING-4, §3.2, Q-P1-06."""

import pytest

from interval_db.generated import RightsProfile
from interval_jobs.adapters.memory import InMemoryStore
from interval_jobs.ports import SectionRow
from interval_jobs.segment import plan_moments, segment_item

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
    store, _, item_id = ingest_fake("article_mixed.html")
    segment_item(store, item_id)
    got = moments(store, item_id)

    assert [m[0] for m in got] == list(range(len(got)))
    assert got[0][1:] == ("How our write-ahead log works", 1, ARTICLE_URL, "page_top")
    by_title = {m[1]: m for m in got[1:]}
    assert by_title["Setup"][3:] == (f"{ARTICLE_URL}#setup", "anchor")
    assert by_title["Log shipping"][3:] == (f"{ARTICLE_URL}#log-shipping", "anchor")
    assert by_title["Plain heading"][3:] == (
        f"{ARTICLE_URL}#:~:text=Plain%20heading",
        "text_fragment",
    )
    # 68 prose words + 180 code tokens = 248 words -> ceil(248 / 230) = 2 minutes.
    assert by_title["Log shipping"][2] == 2


def test_headings_without_ids_get_encoded_text_fragment_links() -> None:
    store, _, item_id = ingest_fake("article_no_ids.html")
    segment_item(store, item_id)
    links = {m[1]: (m[3], m[4]) for m in moments(store, item_id)}

    assert links["Leaders & followers"] == (
        f"{ARTICLE_URL}#:~:text=Leaders%20%26%20followers",
        "text_fragment",
    )
    assert links["Quorum, reads-writes"] == (
        f"{ARTICLE_URL}#:~:text=Quorum%2C%20reads%2Dwrites",
        "text_fragment",
    )


def test_minutes_round_up_with_a_minimum_of_one() -> None:
    store, _, item_id = ingest_fake("article_no_ids.html")
    segment_item(store, item_id)
    minutes = {m[1]: m[2] for m in moments(store, item_id)}

    assert minutes["Leaders & followers"] == 2  # 25 x 17 = 425 words -> ceil(425 / 230)
    assert minutes["Quorum, reads-writes"] == 1  # 6 x 17 = 102 words, below one minute


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
    store, _, item_id = ingest_fake("article_mixed.html")
    first, first_ids = moments(store, item_id), ids(store, item_id)
    segment_item(store, item_id)
    assert moments(store, item_id) == first
    assert ids(store, item_id) == first_ids


def test_ingest_segments_and_reingest_with_new_html_replaces_the_moments() -> None:
    store, _, item_id = ingest_fake("article_mixed.html")
    assert len(moments(store, item_id)) > 2

    _, _, again = ingest_fake("article_v2.html", store=store)
    assert again == item_id
    assert [m[1] for m in moments(store, item_id)] == [
        "How our write-ahead log works",
        "Only section",
    ]

    _, _, again = ingest_fake("article_no_headings.html", store=store)
    assert moments(store, item_id) == []


def test_headings_without_content_give_no_moments() -> None:
    sections = [SectionRow(heading=None, anchor_id=None, word_count=300)]
    sections.append(SectionRow(heading="Empty", anchor_id="e", word_count=0))
    assert plan_moments("T", "https://a.example.test/p", sections) == []
