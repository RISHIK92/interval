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
from datetime import UTC, datetime, timedelta
from typing import Literal

from pydantic import BaseModel

from interval_db.messages import (
    CheckLink,
    DiscoverSource,
    EmbedItem,
    FetchItem,
    GenerateQuestions,
    MessageName,
    PolishNote,
    RecomputeFeed,
    SegmentItem,
    TagItem,
    ValidateQuestion,
)
from interval_jobs import log
from interval_jobs.ai.gateway import AiGateway, OverBudget
from interval_jobs.concept_vectors import concept_text, text_hash
from interval_jobs.embedding import embed_item
from interval_jobs.feed.notes import polish_note, queue_polish
from interval_jobs.feed.precompute import recompute_user_feed
from interval_jobs.frameable import framed_at
from interval_jobs.ingest.feed import NoValidEntryError, valid_entries
from interval_jobs.link_health import check_link
from interval_jobs.normalize import page_canonical, simhash
from interval_jobs.polling import MIN_INTERVAL, next_interval
from interval_jobs.ports import (
    ConceptGraph,
    Delivery,
    Extractor,
    Fetcher,
    JobQueue,
    ModelError,
    QuestionTarget,
    QueueHandler,
    RobotsDisallowed,
    SourceRecord,
    Store,
    TagInput,
    Validators,
)
from interval_jobs.questions import PROMPT_VERSION as QUESTIONS_PROMPT_VERSION
from interval_jobs.questions import (
    QuestionReplyError,
    content_hash,
    parse_answer,
    parse_reply,
    prompt,
    shuffled,
    validation_prompt,
)
from interval_jobs.rights import EXCERPT_MAX_CHARS, allowed
from interval_jobs.segment import segment_item
from interval_jobs.tagging import (
    DECISIONS_PREFIX,
    PROMPT_VERSION,
    TaggingError,
    active_concepts,
    moment_texts,
    tag_item,
)
from interval_jobs.tagging_decide import decide
from interval_jobs.tagging_rollup import rollup

# Every queue the consumer serves: ingestion in the order an item moves through it,
# then the per-user feed recompute (CACHE-1, P1-W4-S04) and its notes' polish (W4-S06),
# and the weekly link health check (P1-W6-S03).
STAGES: tuple[MessageName, ...] = (
    "discover_source",
    "fetch_item",
    "segment_item",
    "tag_item",
    "embed_item",
    "recompute_feed",
    "polish_note",
    "check_link",
    "generate_questions",
    "validate_question",
)

# Q-P2-10: the free question model is an unimportant background task. A rate limit or
# a model error waits this long and tries again, without end (the queue's own retries,
# ATTEMPTS, would give up); a reply that breaks a rule does too, up to
# QUESTION_BROKEN_REPLIES times, so a moment the model can't do doesn't spend the free
# tier's daily requests forever. Config and infrastructure errors still raise.
QUESTION_RETRY_SECONDS = 300
# Q-P2-13: QUESTIONS_MODEL=batch:<model> drafts and validates through the provider's
# batch API (question_batches.py) instead of one call per moment here.
BATCH_PREFIX = "batch:"
QUESTION_BROKEN_REPLIES = 5
# A retry this far past due was lost (a flushed queue): a fresh start is taken.
QUESTION_RETRY_LOST = timedelta(minutes=30)


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


def moment_text(store: Store, target: QuestionTarget | None) -> str:
    """A question target's text, as drafting reads it; empty when there is none."""
    if target is None:
        return ""
    item = store.tags.input(target.item_id)
    if item is None or item.full_text is None:
        return ""
    return moment_texts(item.full_text, item.moments).get(target.moment_id, "").strip()


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
        questions: ModelJob | None = None,
    ) -> None:
        self._unit = unit_of_work
        self._queue = queue
        self._clock = clock
        self._tagging = tagging
        self._embedding = embedding
        # Only for a one-off local run (consume --max-entries); polls take whole feeds.
        self._max_entries = max_entries
        self._notes = notes
        self._questions = questions

    def handlers(self) -> dict[MessageName, QueueHandler]:
        return {
            "discover_source": self._discover_stage,
            "fetch_item": self._stage(self._fetch),
            "segment_item": self._stage(self._segment),
            "tag_item": self._tag_stage,
            "embed_item": self._embed_stage,
            "recompute_feed": self._recompute_stage,
            "polish_note": self._polish_stage,
            "check_link": self._stage(self._check_link),
            "generate_questions": self._questions_stage,
            "validate_question": self._validate_stage,
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

    def _check_link(self, services: StageServices, message: BaseModel) -> list[Next]:
        assert isinstance(message, CheckLink)
        check_link(
            services.store, services.fetcher, message.content_item_id, self._clock()
        )
        return []

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
        canonical = page_canonical(article.body, article.encoding, article.url)
        store.items.set_canonical(item_id, canonical)
        # ADR-0018: known from this fetch's headers, before any weekly check, for the
        # address the reader will frame.
        if article.frameable is not None:
            store.items.set_frameable(
                item_id, framed_at(canonical, headers_allow=article.frameable)
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
        # Moments are embedded, then tagged (the shortlist reuses their vectors); they
        # reach users' feeds at each user's next recompute (hourly, or after
        # feedback, Q-P1-17).
        return self._embed_if_needed(store, item_id) or self._tag_if_needed(
            store, item_id
        )

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
            then = self._tag_if_needed(services.store, item_id)
        # Once per item and model (AI-4); duplicates aren't shown, so not embedded.
        if item is None or not missing:
            self._enqueue(then)
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
        self._enqueue(then)

    def _questions_for(self, store: Store, item_id: int) -> list[Next]:
        """Q-P2-09: each tagged full-text moment's questions, once tagging saved its
        tags; drafting skips a moment whose text and prompt are unchanged (AI-4). In
        batch mode (Q-P2-13) the batch commands draft instead."""
        if self._questions is None or self._questions.model.startswith(BATCH_PREFIX):
            return []
        return [
            (
                "generate_questions",
                {"moment_id": moment_id, "attempt": 0, "broken": 0},
                f"questions-{moment_id}-v{QUESTIONS_PROMPT_VERSION}",
            )
            for moment_id in store.questions.targets(item_id)
        ]

    def _questions_stage(self, message: BaseModel, delivery: Delivery) -> None:
        """Q-1: draft a tagged moment's questions (P2-W8-S01). Read, call the model
        with no transaction open, then save, as tagging does."""
        assert isinstance(message, GenerateQuestions)
        moment_id, job = message.moment_id, self._questions
        if job is None or job.model.startswith(BATCH_PREFIX):
            log.info("pipeline: sync questions are off", moment_id=moment_id)
            return
        now = self._clock()
        with self._unit() as services:
            questions = services.store.questions
            target = questions.target(moment_id)
            drafted = questions.drafted_hash(moment_id)
            pending_ids = questions.pending_ids(moment_id)
            retry = questions.retry_state(moment_id)
            text = moment_text(services.store, target)
        # One retry chain per moment: a re-tag or a second backfill while a retry
        # waits starts another, which is dropped here.
        if (
            retry is not None
            and message.attempt < retry[0]
            and now < retry[1] + QUESTION_RETRY_LOST
        ):
            log.info("questions: a newer retry is waiting", moment_id=moment_id)
            return
        if target is None or not text:
            log.info("questions: not a target now", moment_id=moment_id)
            return
        slugs = [slug for slug, _ in target.concepts]
        digest = content_hash(text, slugs)
        if digest == drafted:
            # AI-4: drafted once per text, concepts and prompt. A backfill still
            # re-queues the validation of any draft left pending (a validator that
            # gave up, rights that came back, a crash before the enqueue).
            self._validate_later(pending_ids)
            return
        broken = message.broken
        try:
            with job.gateway() as gateway:
                answered = gateway.complete(
                    feature="questions",
                    user_id=None,
                    model=job.model,
                    messages=prompt(text, [name for _, name in target.concepts]),
                )
            if isinstance(answered, OverBudget):
                raise ModelError(f"the {answered.scope} AI budget is spent")
            drafts = parse_reply(answered.text, text)
        except (ModelError, QuestionReplyError) as error:
            attempt = message.attempt + 1
            # The retry state first: the retry it describes may run as soon as it's
            # queued.
            with self._unit() as services:
                services.store.questions.record_retry(
                    moment_id, attempt, now + timedelta(seconds=QUESTION_RETRY_SECONDS)
                )
            if not self._retry_question_call(
                "generate_questions",
                {"moment_id": moment_id},
                f"questions-{moment_id}-v{QUESTIONS_PROMPT_VERSION}",
                attempt,
                broken,
                error,
            ):
                with self._unit() as services:
                    services.store.questions.clear_retry(moment_id)
            return
        with self._unit() as services:
            # The moment changed or lost its target while the model ran: the next
            # tagging pass queues it again.
            current = services.store.questions.target(moment_id)
            if current is None or moment_text(services.store, current) != text:
                log.info(
                    "questions: moment changed; drafts dropped", moment_id=moment_id
                )
                return
            saved = services.store.questions.save(
                moment_id,
                [shuffled(draft) for draft in drafts],
                [slug for slug, _ in current.concepts],
                job.model,
                QUESTIONS_PROMPT_VERSION,
                content_hash(text, [slug for slug, _ in current.concepts]),
                current.difficulty,
            )
        # Q-1: each draft goes to the blind validator (P2-W8-S02), after the commit.
        self._validate_later(saved)

    def _validate_later(self, question_ids: list[int]) -> None:
        for question_id in question_ids:
            self._queue.enqueue(
                "validate_question",
                {"question_id": question_id, "attempt": 0, "broken": 0},
                idempotency_key=f"validate-{question_id}",
            )

    def _retry_question_call(
        self,
        name: Literal["generate_questions", "validate_question"],
        ids: dict[str, object],
        key: str,
        attempt: int,
        broken: int,
        error: Exception,
    ) -> bool:
        """Q-P2-10: a rate limit or model error tries again in 5 minutes without end;
        a reply that breaks a rule does too, until QUESTION_BROKEN_REPLIES of them.
        False when it gave up."""
        if isinstance(error, QuestionReplyError):
            broken += 1
        if broken >= QUESTION_BROKEN_REPLIES:
            log.warn(
                "questions: giving up after broken replies",
                stage=name,
                broken=broken,
                error=str(error),
                **ids,
            )
            return False
        log.warn(
            "questions: retrying in 5 minutes",
            stage=name,
            attempt=attempt,
            broken=broken,
            error=str(error),
            **ids,
        )
        self._queue.enqueue(
            name,
            {**ids, "attempt": attempt, "broken": broken},
            idempotency_key=f"{key}-try{attempt}",
            delay_seconds=QUESTION_RETRY_SECONDS,
        )
        return True

    def _validate_stage(self, message: BaseModel, delivery: Delivery) -> None:
        """Q-1: answer a pending question blind; live if it matches the key, else
        rejected (P2-W8-S02). A decided or retired question is skipped, so a
        repeated delivery changes nothing."""
        assert isinstance(message, ValidateQuestion)
        question_id, job = message.question_id, self._questions
        if job is None or job.model.startswith(BATCH_PREFIX):
            log.info("pipeline: sync questions are off", question_id=question_id)
            return
        with self._unit() as services:
            pending = services.store.questions.pending(question_id)
            target = (
                None if pending is None else services.store.questions.target(pending[0])
            )
            text = moment_text(services.store, target)
        if pending is None:
            return  # decided, retired or gone: a repeat delivery
        if not text:
            # Its moment lost its rights or tags meanwhile (ING-2): left pending, and
            # a later backfill re-queues it if they come back.
            log.warn(
                "questions: pending, but its moment isn't a target",
                question_id=question_id,
            )
            return
        try:
            with job.gateway() as gateway:
                answered = gateway.complete(
                    feature="questions",
                    user_id=None,
                    model=job.model,
                    messages=validation_prompt(text, pending[1]),
                )
            if isinstance(answered, OverBudget):
                raise ModelError(f"the {answered.scope} AI budget is spent")
            answer = parse_answer(answered.text)
        except (ModelError, QuestionReplyError) as error:
            self._retry_question_call(
                "validate_question",
                {"question_id": question_id},
                f"validate-{question_id}",
                message.attempt + 1,
                message.broken,
                error,
            )
            return
        with self._unit() as services:
            decided = services.store.questions.record_verdict(
                question_id, job.model, answer
            )
        if decided:
            log.info(
                "questions: validated",
                question_id=question_id,
                agreed=answer == pending[1].correct,
            )
        else:
            log.info("questions: decided or retired meanwhile", question_id=question_id)

    def _tag_if_needed(self, store: Store, item_id: int) -> list[Next]:
        if self._tagging is None or not store.tags.needs_tagging(
            item_id, PROMPT_VERSION
        ):
            return []
        key = f"tag-{item_id}-v{PROMPT_VERSION}"
        return [("tag_item", {"content_item_id": item_id}, key)]

    def _tag_by_decisions(
        self, item_id: int, item: TagInput, graph: ConceptGraph
    ) -> None:
        """Tagging v3 (2026-10-27): ask the decision model about moments whose content
        changed (a shortlist of concepts each), keep the raw answers, roll them up."""
        assert self._tagging is not None
        if self._embedding is None:
            log.warn(
                "pipeline: decision tagging needs EMBEDDING_MODEL for its shortlist",
                content_item_id=item_id,
            )
            return
        decider = self._tagging.model.removeprefix(DECISIONS_PREFIX)
        active = {c.slug for c in graph.concepts if not c.retired}
        with self._unit() as services:
            stored = services.store.concepts.vectors(self._embedding.model)
            known = services.store.decisions.moment_hashes(item_id, decider)
            known_item = services.store.decisions.item_hash(item_id, decider)
            embedded = services.store.embeddings.vectors_of_item(
                item_id, self._embedding.model
            )
            # Re-fetched since the tag stage read it: these vectors may be of the new
            # text, and re-segmenting queues a fresh pass.
            if services.store.tags.input(item_id) != item:
                log.info(
                    "pipeline: item changed; tagging left to the next pass",
                    content_item_id=item_id,
                )
                return
        by_slug = {c.slug: c for c in graph.concepts}
        vectors = {slug: v for slug, (_, v) in stored.items() if slug in active}
        fresh = [
            slug
            for slug, (digest, _) in stored.items()
            if slug in active
            and digest
            == text_hash(concept_text(by_slug[slug].name, by_slug[slug].description))
        ]
        if len(fresh) < len(active):
            # Missing or stale vectors make the shortlist worse, quietly: say so; the
            # fix is embed-concepts.
            log.warn(
                "pipeline: concept vectors missing or stale; run embed-concepts",
                missing_or_stale=len(active) - len(fresh),
            )
        with self._tagging.gateway() as gateway:
            asked = decide(
                gateway,
                decider,
                self._embedding.model,
                item,
                graph,
                vectors,
                known,
                known_item,
                embedded=embedded,
            )
        questions: list[Next] = []
        with self._unit() as services:
            now = services.store.tags.input(item_id)
            if now is None or now.moments != item.moments:
                log.info(
                    "pipeline: moments changed; answers dropped",
                    content_item_id=item_id,
                )
                return
            decisions = services.store.decisions
            for moment_id, answer in asked.moments.items():
                decisions.save_moment(
                    moment_id,
                    decider,
                    answer.content_hash,
                    answer.difficulty,
                    answer.probabilities,
                )
            if asked.item is not None:
                decisions.save_item(
                    item_id,
                    decider,
                    asked.item.content_hash,
                    asked.item.difficulty,
                    asked.item.probabilities,
                )
            # Answers paid for are kept even when the pass stopped part way: the hash
            # skip resumes from them next time.
            if asked.refused is None and asked.stopped is None:
                services.store.tags.save(
                    item_id,
                    rollup(
                        decisions.read(item_id, decider), active, current=asked.current
                    ),
                    self._tagging.model,
                    PROMPT_VERSION,
                )
                questions = self._questions_for(services.store, item_id)
        self._enqueue(questions)
        if asked.refused is not None:
            # LOAD-5: degrade, observably; the next poll queues it again.
            log.warn(
                "pipeline: tagging over budget",
                content_item_id=item_id,
                scope=asked.refused.scope,
            )
        elif asked.stopped is not None:
            raise TaggingError(asked.stopped)  # the queue retries; answers are kept

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
        if graph is None or not active_concepts(graph):
            log.warn(
                "pipeline: no concept graph loaded; not tagged", content_item_id=item_id
            )
            return
        if self._tagging.model.startswith(DECISIONS_PREFIX):
            self._tag_by_decisions(item_id, item, graph)
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
            questions = self._questions_for(services.store, item_id)
        self._enqueue(questions)
