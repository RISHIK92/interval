"""The staged ingestion pipeline (ING-1, LOAD-3): discover, then fetch and extract, then
segment, each stage a queue message (ADR-0014).

Every stage:
- checks the source's rights profile first (ING-2), so a message sent before a profile
  was lowered does nothing;
- is idempotent (LOAD-5): stores are upserts or replacements, so a redelivery or a
  duplicate changes nothing;
- runs in its own unit of work and enqueues the next stage only after it commits, so a
  later stage never sees uncommitted rows.
Discover keeps the feed's validators (conditional requests) only once its follow-ups are
queued: kept any earlier, a retry would get a 304 and the new entries would be lost.
A stage that raises is retried; after the third failure the message goes to the failed
store (the queue's job). Classify joins in W3-S02.

Normalize (Q-P1-08) runs inside discover and fetch: feed links arrive cleaned of
tracking parameters, fetch refines the canonical URL from the page and fingerprints
full text, and both link duplicates to the earliest-published item.
"""

from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import UTC, datetime

from pydantic import BaseModel

from interval_db.messages import (
    DiscoverSource,
    EmbedItem,
    FetchItem,
    MessageName,
    PolishNote,
    RecomputeFeed,
    SegmentItem,
    TagItem,
)
from interval_jobs import log
from interval_jobs.ai.gateway import AiGateway, OverBudget
from interval_jobs.embedding import embed_item
from interval_jobs.feed.notes import polish_note, queue_polish
from interval_jobs.feed.precompute import recompute_user_feed
from interval_jobs.ingest.feed import NoValidEntryError, valid_entries
from interval_jobs.normalize import page_canonical, simhash
from interval_jobs.polling import MIN_INTERVAL, next_interval
from interval_jobs.ports import (
    Delivery,
    Extractor,
    Fetcher,
    JobQueue,
    QueueHandler,
    RobotsDisallowed,
    SourceRecord,
    Store,
    Validators,
)
from interval_jobs.rights import EXCERPT_MAX_CHARS, allowed
from interval_jobs.segment import segment_item
from interval_jobs.tagging import PROMPT_VERSION, active_concepts, tag_item

# Every queue the consumer serves: ingestion in the order an item moves through it,
# then the per-user feed recompute (CACHE-1, P1-W4-S04) and its notes' polish (W4-S06).
STAGES: tuple[MessageName, ...] = (
    "discover_source",
    "fetch_item",
    "segment_item",
    "tag_item",
    "embed_item",
    "recompute_feed",
    "polish_note",
)


@dataclass(frozen=True)
class StageServices:
    store: Store
    fetcher: Fetcher
    extractor: Extractor


type UnitOfWork = Callable[[], AbstractContextManager[StageServices]]


@dataclass(frozen=True)
class ModelJob:
    """A model-backed stage (tagging P1-W3-S02, embeddings P1-W3-S04): the model its
    eval picked, and a gateway per call (its ledger connection commits on its own,
    OPS-4)."""

    model: str
    gateway: Callable[[], AbstractContextManager[AiGateway]]


type Next = tuple[MessageName, dict[str, object], str]
# The feed URL and what it answered with; None when nothing is to be kept.
type Answered = tuple[str, Validators | None] | None


class Pipeline:
    def __init__(
        self,
        unit_of_work: UnitOfWork,
        queue: JobQueue,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        tagging: ModelJob | None = None,
        embedding: ModelJob | None = None,
        max_entries: int | None = None,
        notes: ModelJob | None = None,
    ) -> None:
        self._unit = unit_of_work
        self._queue = queue
        self._clock = clock
        self._tagging = tagging
        self._embedding = embedding
        # Only for a one-off local run (consume --max-entries); polls take whole feeds.
        self._max_entries = max_entries
        self._notes = notes

    def handlers(self) -> dict[MessageName, QueueHandler]:
        return {
            "discover_source": self._discover_stage,
            "fetch_item": self._stage(self._fetch),
            "segment_item": self._stage(self._segment),
            "tag_item": self._tag_stage,
            "embed_item": self._embed_stage,
            "recompute_feed": self._recompute_stage,
            "polish_note": self._polish_stage,
        }

    def _stage(
        self, work: Callable[[StageServices, BaseModel], list[Next]]
    ) -> QueueHandler:
        def handle(message: BaseModel, delivery: Delivery) -> None:
            with self._unit() as services:
                follow_ups = work(services, message)
            self._enqueue(follow_ups)

        return handle

    def _enqueue(self, follow_ups: list[Next]) -> None:
        # After the commit: the next stage must see this stage's rows.
        for name, payload, key in follow_ups:
            self._queue.enqueue(name, payload, idempotency_key=key)

    def _recompute_stage(self, message: BaseModel, delivery: Delivery) -> None:
        assert isinstance(message, RecomputeFeed)
        # Similarity candidates need the embedding model in use; none while it is off.
        model = self._embedding.model if self._embedding else None
        with self._unit() as services:
            done = recompute_user_feed(
                services.store, message.user_id, model, self._clock()
            )
        # After the commit, so the stage sees the notes. Nothing while notes are off:
        # their template wording stands (Q-P1-18).
        if self._notes is not None:
            queue_polish(self._queue, done.unpolished)

    def _polish_stage(self, message: BaseModel, delivery: Delivery) -> None:
        """Read, call the model with no transaction open, then store (as tagging)."""
        assert isinstance(message, PolishNote)
        if self._notes is None:
            log.info("pipeline: notes are off (no model)", note_id=message.note_id)
            return
        with self._unit() as services:
            note = services.store.notes.input(message.note_id)
        if note is None:
            return  # polished already, or its item is gone
        with self._notes.gateway() as gateway:
            text = polish_note(gateway, self._notes.model, note)
        if isinstance(text, OverBudget):
            # OPS-4, LOAD-5: the template stays, observably; the next recompute that
            # shows the note queues it again.
            log.warn("notes: over budget", note_id=note.note_id, scope=text.scope)
            return
        # A refused reply (None) is recorded too: tried once, never paid for again.
        with self._unit() as services:
            services.store.notes.polish(note.note_id, text, self._notes.model)

    def _discover_stage(self, message: BaseModel, delivery: Delivery) -> None:
        with self._unit() as services:
            follow_ups, answered = self._discover(services, message)
        self._enqueue(follow_ups)
        if answered is not None:
            with self._unit() as services:
                services.store.validators.put(*answered)

    def _discover(
        self, services: StageServices, message: BaseModel
    ) -> tuple[list[Next], Answered]:
        assert isinstance(message, DiscoverSource)
        store = services.store
        source = store.sources.get(message.source_id)
        if source is None or not source.active:
            log.info("pipeline: source skipped", source_id=message.source_id)
            return [], None
        store.items.hold_duplicate_lock()
        follow_ups, answered, new_items = self._poll(services, source)
        # ING-3: a poll that raised keeps the turn poll-due claimed, one interval on.
        # Adapt once per turn: a retry, a duplicate delivery or a manual
        # enqueue-discover soon after would otherwise find nothing new and back off.
        now = self._clock()
        if source.polled_at is None or now - source.polled_at >= MIN_INTERVAL:
            interval = next_interval(source.poll_interval, new_items)
            store.sources.record_poll(source.id, interval, now)
        return follow_ups, answered

    def _poll(
        self, services: StageServices, source: SourceRecord
    ) -> tuple[list[Next], Answered, int]:
        """The follow-ups, the validators to keep, and how many entries were new."""
        store = services.store
        known = store.validators.get(source.feed_url)
        try:
            feed = services.fetcher.fetch_if_changed(source.feed_url, "feed", known)
        except RobotsDisallowed:
            log.info("pipeline: robots.txt disallows the feed", source_id=source.id)
            return [], None, 0
        if feed is None:
            return [], None, 0  # 304: nothing new since the last poll
        answered: Answered = (source.feed_url, feed.validators)
        try:
            entries = valid_entries(feed.body, feed.url)
        except NoValidEntryError:
            # Permanent until the publisher fixes it: retrying (and filling the
            # failed store on every poll) wouldn't help.
            log.warn("pipeline: feed has no valid entry", source_id=source.id)
            return [], answered, 0
        if self._max_entries is not None:
            entries = sorted(
                entries,
                key=lambda e: (
                    e.published_at or e.updated_at or datetime.min.replace(tzinfo=UTC)
                ),
                reverse=True,
            )[: self._max_entries]
        seen = store.items.known_guids(source.id, [e.guid for e in entries])
        new_items = sum(1 for e in entries if e.guid not in seen)
        profile = source.rights_profile
        keep_excerpt = allowed(profile, "store_excerpt")
        segments = source.moments_enabled and allowed(profile, "make_moments")
        follow_ups: list[Next] = []
        for entry in entries:
            item_id = store.items.upsert_from_feed(source.id, entry, keep_excerpt)
            store.items.link_duplicates(item_id)
            if not allowed(profile, "fetch_body"):
                follow_ups.extend(self._tag_if_needed(store, item_id))
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
            # Tagging or embedding that failed or was over budget is retried on the
            # next poll.
            else:
                follow_ups.extend(self._tag_if_needed(store, item_id))
                follow_ups.extend(self._embed_if_needed(store, item_id))
        return follow_ups, answered, new_items

    def _fetch(self, services: StageServices, message: BaseModel) -> list[Next]:
        assert isinstance(message, FetchItem)
        store, item_id = services.store, message.content_item_id
        item = store.items.for_fetch(item_id)
        if item is None or not allowed(item.rights_profile, "fetch_body"):
            log.info("pipeline: fetch skipped by rights", content_item_id=item_id)
            return []
        store.items.hold_duplicate_lock()
        # The page stays in memory: only what the profile allows is stored (ING-2).
        try:
            article = services.fetcher.fetch(item.canonical_url, "article")
        except RobotsDisallowed:
            # The publisher's choice, not a failure: no retry, nothing stored.
            log.info(
                "pipeline: robots.txt disallows the article", content_item_id=item_id
            )
            return []
        text = services.extractor.text(article.body, article.encoding)
        store.items.set_canonical(
            item_id, page_canonical(article.body, article.encoding, article.url)
        )
        follow_ups: list[Next] = []
        if allowed(item.rights_profile, "store_full_text"):
            store.items.store_full_text(item_id, text)
            store.items.replace_sections(
                item_id,
                services.extractor.sections(article.body, article.encoding, item.title),
            )
            fingerprint = simhash(text)
            if fingerprint is not None:
                store.items.set_simhash(item_id, fingerprint)
            follow_ups.append(
                ("segment_item", {"content_item_id": item_id}, f"segment-{item_id}")
            )
        elif allowed(item.rights_profile, "store_excerpt"):
            store.items.set_excerpt(item_id, text[:EXCERPT_MAX_CHARS])
            follow_ups.extend(self._tag_if_needed(store, item_id))
        store.items.link_duplicates(item_id)
        return follow_ups

    def _segment(self, services: StageServices, message: BaseModel) -> list[Next]:
        assert isinstance(message, SegmentItem)
        store, item_id = services.store, message.content_item_id
        # segment_item checks the profile and the moments switch itself (ING-2, §3.2)
        # and stores nothing when they don't allow moments.
        segment_item(store, item_id)
        # Moments are tagged and embedded once they exist; they reach users' feeds at
        # each user's next recompute (hourly, or after feedback, Q-P1-17).
        return [
            *self._tag_if_needed(store, item_id),
            *self._embed_if_needed(store, item_id),
        ]

    def _embed_if_needed(self, store: Store, item_id: int) -> list[Next]:
        job = self._embedding
        if job is None or not store.embeddings.missing(item_id, job.model):
            return []
        return [("embed_item", {"content_item_id": item_id}, f"embed-{item_id}")]

    def _embed_stage(self, message: BaseModel, delivery: Delivery) -> None:
        """Like tagging: read, call the model outside any transaction, then save only
        if the moments didn't change meanwhile."""
        assert isinstance(message, EmbedItem)
        item_id, job = message.content_item_id, self._embedding
        if job is None:
            log.info("pipeline: embeddings are off (no model)", content_item_id=item_id)
            return
        with self._unit() as services:
            item = services.store.tags.input(item_id)
            missing = services.store.embeddings.missing(item_id, job.model)
            done = services.store.embeddings.done(item_id, job.model)
        # Once per item and model (AI-4); duplicates aren't shown, so not embedded.
        if item is None or not missing:
            return
        with job.gateway() as gateway:
            embedded = embed_item(gateway, job.model, item, skip=done)
        if embedded.refused is not None:
            # LOAD-5: degrade, observably; what was paid for is kept and the next
            # poll finishes the item.
            log.warn(
                "pipeline: embedding over budget",
                content_item_id=item_id,
                scope=embedded.refused.scope,
            )
        with self._unit() as services:
            now = services.store.tags.input(item_id)
            if now is None or now.moments != item.moments:
                log.info(
                    "pipeline: moments changed; vectors dropped",
                    content_item_id=item_id,
                )
                return
            services.store.embeddings.save(
                item_id,
                embedded.vectors,
                job.model,
                complete=embedded.refused is None,
            )

    def _tag_if_needed(self, store: Store, item_id: int) -> list[Next]:
        if self._tagging is None or not store.tags.needs_tagging(
            item_id, PROMPT_VERSION
        ):
            return []
        key = f"tag-{item_id}-v{PROMPT_VERSION}"
        return [("tag_item", {"content_item_id": item_id}, key)]

    def _tag_stage(self, message: BaseModel, delivery: Delivery) -> None:
        """Read, then call the model with no transaction open, then save in a second
        unit of work only if the item's moments didn't change meanwhile."""
        assert isinstance(message, TagItem)
        item_id = message.content_item_id
        if self._tagging is None:
            log.info("pipeline: tagging is off (no model)", content_item_id=item_id)
            return
        with self._unit() as services:
            item = services.store.tags.input(item_id)
            graph = services.store.concepts.state()
        # Once per item (AI-4): not again at this prompt version, not for duplicates.
        if item is None or item.duplicate or item.tagged_version == PROMPT_VERSION:
            return
        if not active_concepts(graph):
            log.warn(
                "pipeline: no concept graph loaded; not tagged", content_item_id=item_id
            )
            return
        with self._tagging.gateway() as gateway:
            tagged = tag_item(gateway, self._tagging.model, item, graph)
        if isinstance(tagged, OverBudget):
            # LOAD-5: degrade, observably; the next poll queues it again.
            log.warn(
                "pipeline: tagging over budget",
                content_item_id=item_id,
                scope=tagged.scope,
            )
            return
        with self._unit() as services:
            now = services.store.tags.input(item_id)
            if now is None or now.moments != item.moments:
                # Re-segmented while the model ran: segmentation queues a fresh pass.
                log.info(
                    "pipeline: moments changed; tags dropped", content_item_id=item_id
                )
                return
            services.store.tags.save(
                item_id, tagged.result, self._tagging.model, PROMPT_VERSION
            )
