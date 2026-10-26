"""Ingest the newest item of one source: fetch, gate on rights, store (ING-1, ING-2).

Works through ports only (ADR-0012); the caller owns the unit of work.
"""

from dataclasses import dataclass
from typing import Literal

from interval_jobs.ingest.feed import newest_entry
from interval_jobs.ports import Extractor, Fetcher, Store
from interval_jobs.rights import EXCERPT_MAX_CHARS, allowed
from interval_jobs.segment import segment_item


@dataclass(frozen=True)
class IngestResult:
    content_item_id: int
    stored: Literal["metadata", "excerpt", "full_text"]


def ingest_one(
    store: Store, fetcher: Fetcher, extractor: Extractor, source_id: int
) -> IngestResult:
    source = store.sources.get(source_id)
    if source is None:
        raise LookupError(f"no source with id {source_id}")
    profile = source.rights_profile

    feed = fetcher.fetch(source.feed_url, "feed")
    entry = newest_entry(feed.body, feed.url)

    # The upsert also drops an excerpt the current profile no longer allows.
    item_id = store.items.upsert_from_feed(
        source.id, entry, keep_excerpt=allowed(profile, "store_excerpt")
    )
    if not allowed(profile, "store_full_text"):
        store.items.drop_full_text(item_id)

    if not allowed(profile, "fetch_body"):
        return IngestResult(content_item_id=item_id, stored="metadata")

    article = fetcher.fetch(entry.link, "article")
    text = extractor.text(article.body, article.encoding)

    if allowed(profile, "store_full_text"):
        store.items.store_full_text(item_id, text)
        # Heading structure for segmentation (ING-4): headings and counts, no text.
        store.items.replace_sections(
            item_id, extractor.sections(article.body, article.encoding, entry.title)
        )
        # Moments always match the stored structure (owner, 2026-10-25).
        segment_item(store, item_id)
        return IngestResult(content_item_id=item_id, stored="full_text")

    if allowed(profile, "store_excerpt"):
        store.items.set_excerpt(item_id, text[:EXCERPT_MAX_CHARS])
        return IngestResult(content_item_id=item_id, stored="excerpt")

    raise AssertionError(f"profile {profile} fetches a body but stores none")
