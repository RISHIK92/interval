"""The staged ingestion pipeline (ING-1, LOAD-3): discover, then fetch and extract, then
segment, each stage a queue message (ADR-0014).

Every stage:
- checks the source's rights profile first (ING-2), so a message sent before a profile
  was lowered does nothing;
- is idempotent (LOAD-5): stores are upserts or replacements, so a redelivery or a
  duplicate changes nothing;
- runs in its own unit of work and enqueues the next stage only after it commits, so a
  later stage never sees uncommitted rows.
A stage that raises is retried; after the third failure the message goes to the failed
store (the queue's job). Normalize and classify join in W2-S06 and W3-S02.
"""

from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass

from pydantic import BaseModel

from interval_db.messages import DiscoverSource, FetchItem, MessageName, SegmentItem
from interval_jobs import log
from interval_jobs.feed.precompute import rebuild_feed
from interval_jobs.ingest.feed import NoValidEntryError, valid_entries
from interval_jobs.ports import (
    Delivery,
    Extractor,
    Fetcher,
    JobQueue,
    QueueHandler,
    Store,
)
from interval_jobs.rights import EXCERPT_MAX_CHARS, allowed
from interval_jobs.segment import segment_item

# The order a message moves through; the consumer serves all of them.
STAGES: tuple[MessageName, ...] = ("discover_source", "fetch_item", "segment_item")


@dataclass(frozen=True)
class StageServices:
    store: Store
    fetcher: Fetcher
    extractor: Extractor


type UnitOfWork = Callable[[], AbstractContextManager[StageServices]]
type Next = tuple[MessageName, dict[str, object], str]


class Pipeline:
    def __init__(self, unit_of_work: UnitOfWork, queue: JobQueue) -> None:
        self._unit = unit_of_work
        self._queue = queue

    def handlers(self) -> dict[MessageName, QueueHandler]:
        return {
            "discover_source": self._stage(self._discover),
            "fetch_item": self._stage(self._fetch),
            "segment_item": self._stage(self._segment),
        }

    def _stage(
        self, work: Callable[[StageServices, BaseModel], list[Next]]
    ) -> QueueHandler:
        def handle(message: BaseModel, delivery: Delivery) -> None:
            with self._unit() as services:
                follow_ups = work(services, message)
            # After the commit: the next stage must see this stage's rows.
            for name, payload, key in follow_ups:
                self._queue.enqueue(name, payload, idempotency_key=key)

        return handle

    def _discover(self, services: StageServices, message: BaseModel) -> list[Next]:
        assert isinstance(message, DiscoverSource)
        store = services.store
        source = store.sources.get(message.source_id)
        if source is None or not source.active:
            log.info("pipeline: source skipped", source_id=message.source_id)
            return []
        feed = services.fetcher.fetch(source.feed_url, "feed")
        try:
            entries = valid_entries(feed.body, feed.url)
        except NoValidEntryError:
            # Permanent until the publisher fixes it: retrying (and filling the
            # failed store on every poll) wouldn't help.
            log.warn("pipeline: feed has no valid entry", source_id=source.id)
            return []
        profile = source.rights_profile
        keep_excerpt = allowed(profile, "store_excerpt")
        segments = source.moments_enabled and allowed(profile, "make_moments")
        follow_ups: list[Next] = []
        for entry in entries:
            item_id = store.items.upsert_from_feed(source.id, entry, keep_excerpt)
            if not allowed(profile, "fetch_body"):
                continue
            # Fetch once: not again when what the profile keeps is already stored.
            if not store.items.has_body(item_id):
                follow_ups.append(
                    ("fetch_item", {"content_item_id": item_id}, f"fetch-{item_id}")
                )
            # A segment that failed earlier is retried on the next poll.
            elif segments and not store.moments.exist(item_id):
                follow_ups.append(
                    ("segment_item", {"content_item_id": item_id}, f"segment-{item_id}")
                )
        return follow_ups

    def _fetch(self, services: StageServices, message: BaseModel) -> list[Next]:
        assert isinstance(message, FetchItem)
        store, item_id = services.store, message.content_item_id
        item = store.items.for_fetch(item_id)
        if item is None or not allowed(item.rights_profile, "fetch_body"):
            log.info("pipeline: fetch skipped by rights", content_item_id=item_id)
            return []
        # The page stays in memory: only what the profile allows is stored (ING-2).
        article = services.fetcher.fetch(item.canonical_url, "article")
        text = services.extractor.text(article.body, article.encoding)
        if allowed(item.rights_profile, "store_full_text"):
            store.items.store_full_text(item_id, text)
            store.items.replace_sections(
                item_id,
                services.extractor.sections(article.body, article.encoding, item.title),
            )
            return [
                ("segment_item", {"content_item_id": item_id}, f"segment-{item_id}")
            ]
        if allowed(item.rights_profile, "store_excerpt"):
            store.items.set_excerpt(item_id, text[:EXCERPT_MAX_CHARS])
        return []

    def _segment(self, services: StageServices, message: BaseModel) -> list[Next]:
        assert isinstance(message, SegmentItem)
        store, item_id = services.store, message.content_item_id
        # segment_item checks the profile and the moments switch itself (ING-2, §3.2)
        # and stores nothing when they don't allow moments.
        segment_item(store, item_id)
        rebuild_feed(store)
        return []
