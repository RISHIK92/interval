"""Ingest logic on in-memory ports (ADR-0012). ING-1, ING-2, Q-P1-01."""

import pytest

from interval_db.generated import RightsProfile
from interval_jobs.adapters.memory import InMemoryStore
from interval_jobs.adapters.trafilatura_extractor import TrafilaturaExtractor
from interval_jobs.ingest.one import ingest_one
from interval_jobs.ports import FetchError

from .support import ARTICLE_URL, FEED_URL, fake_web, ingest_fake


def test_metadata_only_stores_metadata_and_summary_and_never_fetches_the_article() -> (
    None
):
    store = InMemoryStore()
    source_id = store.sources.upsert(
        name="m", feed_url=FEED_URL, rights_profile="metadata_only", homepage=None
    )
    web = fake_web("article.html")
    item_id = ingest_one(store, web, TrafilaturaExtractor(), source_id).content_item_id

    item = store.items.rows[item_id]
    assert (item.title, item.author, item.canonical_url, item.feed_summary) == (
        "How our write-ahead log works",
        "Alex Author",
        ARTICLE_URL,
        "A short tour of the write-ahead log.",
    )
    assert (item.excerpt, item.full_text, item.sections) == (None, None, [])
    assert [url for url, _ in web.requested] == [FEED_URL]


def test_excerpt_stores_at_most_300_characters_and_no_full_text() -> None:
    store, _, item_id = ingest_fake("article.html", profile="excerpt")
    item = store.items.rows[item_id]
    assert item.excerpt is not None
    assert 0 < len(item.excerpt) <= 300
    assert item.full_text is None


def test_full_text_internal_stores_extracted_text_privately() -> None:
    store, _, item_id = ingest_fake("article.html")
    item = store.items.rows[item_id]
    assert item.full_text is not None
    assert "recovery replays the log" in item.full_text
    assert item.excerpt is None


def test_running_twice_stores_one_item_one_text_and_the_same_sections() -> None:
    store, _, first = ingest_fake("article.html")
    _, _, second = ingest_fake("article.html", store=store)
    assert first == second
    assert len(store.items.rows) == 1
    item = store.items.rows[first]
    assert item.full_text is not None
    assert len(item.sections) == 2


def test_feed_error_raises_and_stores_nothing() -> None:
    store = InMemoryStore()
    source_id = store.sources.upsert(
        name="e", feed_url=FEED_URL, rights_profile="full_text_internal", homepage=None
    )
    web = fake_web("article.html", feed_error=FetchError("HTTP 500"))
    with pytest.raises(FetchError):
        ingest_one(store, web, TrafilaturaExtractor(), source_id)
    assert store.items.rows == {}


@pytest.mark.parametrize(
    ("before", "after"),
    [
        ("full_text_internal", "metadata_only"),
        ("full_text_internal", "excerpt"),
        ("excerpt", "metadata_only"),
    ],
)
def test_reingest_after_lowering_the_profile_keeps_only_what_it_allows(
    before: RightsProfile, after: RightsProfile
) -> None:
    store, _, item_id = ingest_fake("article.html", profile=before)
    ingest_fake("article.html", profile=after, store=store)

    item = store.items.rows[item_id]
    assert item.full_text is None
    assert (item.excerpt is not None) is (after == "excerpt")


@pytest.mark.parametrize(
    ("profile", "has_sections"),
    [("metadata_only", False), ("excerpt", False), ("full_text_internal", True)],
)
def test_section_structure_is_stored_only_for_full_text(
    profile: RightsProfile, has_sections: bool
) -> None:
    store, _, item_id = ingest_fake("article.html", profile=profile)
    ingest_fake("article.html", profile=profile, store=store)
    sections = store.items.rows[item_id].sections
    assert (len(sections) == 2) is has_sections  # two h2 sections; the h1 is the title
    assert (sections == []) is not has_sections
