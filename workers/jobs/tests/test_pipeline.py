"""The staged ingestion pipeline (ING-1, LOAD-3, LOAD-5) on in-memory ports: every
stage retryable and idempotent, failures to the failed store, rights checked first."""

import threading
from collections.abc import Generator, Mapping
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from interval_db.generated import AiProvider, RightsProfile
from interval_db.messages import MessageName
from interval_jobs.adapters.memory import (
    FakeFetcher,
    InMemoryAi,
    InMemoryStore,
    StoredUser,
)
from interval_jobs.adapters.memory_queue import InMemoryQueue
from interval_jobs.adapters.trafilatura_extractor import TrafilaturaExtractor
from interval_jobs.ai.gateway import AiGateway
from interval_jobs.concepts.graph import parse_concepts
from interval_jobs.concepts.sync import sync_concepts
from interval_jobs.pipeline import STAGES, ModelJob, Pipeline, StageServices
from interval_jobs.ports import (
    Completion,
    EmbeddingPurpose,
    Embeddings,
    Fetched,
    FetchError,
    Message,
    MomentRow,
    RobotsDisallowed,
    Usage,
    UserPreferences,
    Validators,
)

from .conftest import fixture_bytes

FEED_URL = "https://pipe.example.test/feed.atom"
OLDER = "https://blog.example.test/older-queues"
WAL = "https://blog.example.test/wal"
ETAG = Validators('"feed-v1"', None)
NOW = datetime(2026, 10, 26, 12, tzinfo=UTC)


def web(
    failing: str | None = None,
    blocked: str | None = None,
    extra: dict[str, Fetched] | None = None,
) -> FakeFetcher:
    pages: dict[str, Fetched | FetchError] = {
        FEED_URL: Fetched(FEED_URL, fixture_bytes("atom.xml"), "utf-8", ETAG),
        OLDER: Fetched(OLDER, fixture_bytes("article_v2.html"), "utf-8"),
        WAL: Fetched(WAL, fixture_bytes("article.html"), "utf-8"),
        **(extra or {}),
    }
    if failing is not None:
        pages[failing] = FetchError("HTTP 503")
    if blocked is not None:
        pages[blocked] = RobotsDisallowed("robots.txt disallows it")
    return FakeFetcher(pages)


class World:
    def __init__(
        self,
        profile: RightsProfile = "full_text_internal",
        moments: bool = True,
        failing: str | None = None,
        blocked: str | None = None,
        extra: dict[str, Fetched] | None = None,
        tagging: ModelJob | None = None,
        embedding: ModelJob | None = None,
        max_entries: int | None = None,
        notes: ModelJob | None = None,
    ) -> None:
        self.store = InMemoryStore()
        self.fetcher = web(failing, blocked, extra)
        self.queue = InMemoryQueue()
        self.source_id = self.store.sources.upsert(
            name="pipe", feed_url=FEED_URL, rights_profile=profile, homepage=None
        )
        self.store.sources.set_moments_enabled(self.source_id, moments)

        @contextmanager
        def unit() -> Generator[StageServices]:
            yield StageServices(self.store, self.fetcher, TrafilaturaExtractor())

        self.now = NOW
        self.pipeline = Pipeline(
            unit,
            self.queue,
            clock=lambda: self.now,
            tagging=tagging,
            embedding=embedding,
            max_entries=max_entries,
            notes=notes,
        )

    def discover(self, key: str = "poll-1") -> None:
        self.queue.enqueue(
            "discover_source", {"source_id": self.source_id}, idempotency_key=key
        )

    def run(self) -> None:
        """Delivers every stage until all queues are empty."""
        handlers = self.pipeline.handlers()
        while any(self.queue.pending(name) for name in STAGES):
            for name in STAGES:
                self.queue.consume(name, handlers[name], threading.Event())

    def requested(self) -> list[str]:
        return [url for url, _ in self.fetcher.requested]


def test_a_full_text_source_flows_from_discovery_to_moments() -> None:
    world = World()
    world.discover()
    world.run()
    items = world.store.items.rows.values()
    assert sorted(i.canonical_url for i in items) == [OLDER, WAL]
    assert all(i.full_text for i in items)
    assert world.store.moments.rows, "segmentation produced moments"


def test_a_capped_run_takes_only_the_newest_entries_of_each_feed() -> None:
    # A one-off local run (consume --max-entries) samples many sources cheaply.
    world = World(max_entries=1)
    world.discover()
    world.run()
    assert [i.canonical_url for i in world.store.items.rows.values()] == [WAL]
    assert world.requested() == [FEED_URL, WAL]


def test_redelivered_messages_create_nothing_twice() -> None:
    world = World()
    world.discover("poll-1")
    world.run()
    moments = len(world.store.moments.rows)
    world.discover("poll-2")  # a later poll of an unchanged feed
    world.run()
    assert len(world.store.items.rows) == 2
    assert len(world.store.moments.rows) == moments
    # Bodies already stored aren't fetched again.
    assert world.requested().count(WAL) == 1


def test_metadata_only_sources_never_fetch_bodies() -> None:
    world = World(profile="metadata_only", moments=False)
    world.discover()
    world.run()
    assert len(world.store.items.rows) == 2
    assert world.requested() == [FEED_URL]
    assert all(i.full_text is None for i in world.store.items.rows.values())


def test_excerpt_sources_fetch_each_article_once() -> None:
    world = World(profile="excerpt", moments=False)
    world.discover("poll-1")
    world.run()
    world.discover("poll-2")
    world.run()
    assert all(i.excerpt for i in world.store.items.rows.values())
    # Headings are extracted only under full-text rights (P1-W2-S05).
    assert all(i.sections == [] for i in world.store.items.rows.values())
    assert world.requested().count(WAL) == 1


def test_a_stale_fetch_does_nothing_once_the_profile_forbids_bodies() -> None:
    world = World(profile="metadata_only", moments=False)
    world.discover()
    world.run()
    item_id = next(iter(world.store.items.rows))
    # Sent before the profile was lowered: it must not fetch.
    world.queue.enqueue(
        "fetch_item", {"content_item_id": item_id}, idempotency_key="old"
    )
    world.run()
    assert world.requested() == [FEED_URL]


def test_a_stale_segment_makes_no_moments_once_moments_are_off() -> None:
    world = World()
    world.discover()
    world.run()
    assert world.store.moments.rows
    world.store.sources.set_moments_enabled(world.source_id, False)  # purges them
    item_id = next(iter(world.store.items.rows))
    world.queue.enqueue(
        "segment_item", {"content_item_id": item_id}, idempotency_key="old"
    )
    world.run()
    assert world.store.moments.rows == []


def test_an_item_whose_segmenting_failed_is_segmented_on_the_next_full_poll() -> None:
    world = World()
    world.discover("poll-1")
    # Fetch only: segmentation never ran (as if it had landed in the failed store).
    handlers = world.pipeline.handlers()
    for name in ("discover_source", "fetch_item"):
        world.queue.consume(name, handlers[name], threading.Event())
    world.queue.drop_pending("segment_item")
    assert world.store.moments.rows == []
    world.discover("poll-2")  # same day: the feed answers 304
    world.run()
    assert world.store.moments.rows == []
    validators, stored = world.store.validators.rows[FEED_URL]
    world.store.validators.rows[FEED_URL] = (validators, stored - timedelta(days=2))
    world.discover("poll-3")  # a day on: a full fetch re-queues the segment
    world.run()
    assert world.store.moments.rows


def test_a_feed_with_no_valid_entries_is_logged_not_retried(
    capsys: pytest.CaptureFixture[str],
) -> None:
    world = World()
    world.fetcher = FakeFetcher(
        {FEED_URL: Fetched(FEED_URL, fixture_bytes("empty.xml"), "utf-8")}
    )
    world.discover()
    world.run()
    # Permanent: no point retrying it or filling the failed store every poll.
    assert world.queue.failed_messages("discover_source") == []
    assert world.requested() == [FEED_URL]
    assert "pipeline: feed has no valid entry" in capsys.readouterr().out


def test_an_inactive_source_is_not_polled() -> None:
    world = World()
    world.store.sources.rows[world.source_id].active = False
    world.discover()
    world.run()
    assert world.requested() == []


def test_a_stage_failing_three_times_lands_in_the_failed_store() -> None:
    world = World(failing=OLDER)
    world.discover()
    world.run()
    failed = world.queue.failed_messages("fetch_item")
    assert len(failed) == 1
    # The other item went through.
    wal = next(i for i in world.store.items.rows.values() if i.canonical_url == WAL)
    assert wal.full_text
    assert world.requested().count(OLDER) == 3


def test_an_unchanged_feed_costs_one_request_and_does_nothing() -> None:
    world = World()
    world.discover("poll-1")
    world.run()
    before = len(world.fetcher.requested)
    world.discover("poll-2")  # the fake answers 304 to the stored ETag
    world.run()
    assert world.fetcher.requested[before:] == [(FEED_URL, "feed")]


def test_a_discover_retried_after_a_failed_enqueue_still_queues_the_items() -> None:
    world = World()
    enqueue = world.queue.enqueue
    failures = [RuntimeError("queue unavailable")]

    def flaky(
        name: MessageName,
        message: Mapping[str, object],
        idempotency_key: str,
        delay_seconds: int = 0,
    ) -> None:
        if name == "fetch_item" and failures:
            raise failures.pop()
        enqueue(name, message, idempotency_key, delay_seconds)

    world.queue.enqueue = flaky  # type: ignore[method-assign]
    world.discover()
    world.run()
    # The retry fetched the feed again instead of being told "304, nothing new".
    assert all(i.full_text for i in world.store.items.rows.values())
    assert world.store.validators.get(FEED_URL) == ETAG


def test_an_article_robots_disallows_is_skipped_not_retried() -> None:
    world = World(blocked=OLDER)
    world.discover()
    world.run()
    assert world.queue.failed_messages("fetch_item") == []
    assert world.requested().count(OLDER) == 1


def test_the_same_article_from_two_sources_shows_once_in_a_users_feed() -> None:
    mirror = "https://mirror.example.test/feed.atom"
    world = World(extra={mirror: Fetched(mirror, fixture_bytes("atom.xml"), "utf-8")})
    other = world.store.sources.upsert(
        name="mirror",
        feed_url=mirror,
        rights_profile="full_text_internal",
        homepage=None,
    )
    world.store.sources.set_moments_enabled(other, True)
    for sid in (world.source_id, other):
        world.store.sources.rows[sid].topics = ("databases",)
    world.discover()
    world.queue.enqueue("discover_source", {"source_id": other}, idempotency_key="m-1")
    world.run()
    items = list(world.store.items.rows.values())
    assert len(items) == 4
    primaries = [i for i in items if i.duplicate_of is None]
    assert sorted(i.canonical_url for i in primaries) == [OLDER, WAL]
    # The recompute stage (CACHE-1, P1-W4-S04) stores the user's ranked feed.
    world.store.users.rows["u1"] = StoredUser("u1", is_anonymous=True)
    world.store.ranking.preferences_by_user["u1"] = UserPreferences(
        topics=["databases"], level="intermediate", break_length="8-15"
    )
    world.queue.enqueue("recompute_feed", {"user_id": "u1"}, idempotency_key="r-1")
    world.run()
    shown = {r.item_id for r in world.store.feed.users["u1"]["8-15"]}
    assert shown == {i.id for i in primaries}
    assert world.store.feed.computed["u1"] == world.now


def test_the_fetch_refines_the_canonical_url_and_fingerprints_full_text() -> None:
    page = fixture_bytes("article.html").replace(
        b"<head>", b'<head><link rel="canonical" href="/wal-final?utm_source=x">'
    )
    world = World(extra={WAL: Fetched(WAL + "?ref=feed", page, "utf-8")})
    world.discover()
    world.run()
    wal = next(i for i in world.store.items.rows.values() if i.guid.endswith(":wal"))
    assert wal.canonical_url == "https://blog.example.test/wal-final"
    assert wal.simhash is not None


def test_each_poll_reschedules_the_source_by_what_it_found() -> None:
    world = World()
    world.discover("poll-1")  # two new items: poll sooner
    world.run()
    record = world.store.sources.get(world.source_id)
    assert record is not None and record.poll_interval == timedelta(minutes=30)
    assert world.source_id not in world.store.sources.claim_due(
        NOW + timedelta(minutes=29)
    )
    world.now = NOW + timedelta(minutes=30)
    world.discover("poll-2")  # unchanged feed (304): back off
    world.run()
    record = world.store.sources.get(world.source_id)
    assert record is not None and record.poll_interval == timedelta(minutes=45)


def test_a_redelivered_discover_adapts_the_interval_only_once() -> None:
    world = World()
    world.discover("poll-1")
    world.run()
    world.discover("poll-1-again")  # a redelivery, or an operator's enqueue-discover
    world.run()
    record = world.store.sources.get(world.source_id)
    assert record is not None and record.poll_interval == timedelta(minutes=30)


def test_one_new_entry_among_known_ones_still_speeds_polling_up() -> None:
    world = World()
    world.discover("poll-1")
    world.run()
    newest = next(i for i in world.store.items.rows.values() if i.canonical_url == WAL)
    del world.store.items.rows[newest.id]  # as if the feed had just published it
    world.now = NOW + timedelta(minutes=30)
    world.discover("poll-2")
    world.store.validators.put(FEED_URL, None)  # no 304: the feed changed
    world.run()
    record = world.store.sources.get(world.source_id)
    assert record is not None and record.poll_interval == timedelta(minutes=15)


def test_a_discover_that_fails_keeps_the_turn_poll_due_claimed() -> None:
    world = World(failing=FEED_URL)
    claimed = world.store.sources.claim_due(NOW)
    assert world.source_id in claimed
    world.discover()
    world.run()
    record = world.store.sources.get(world.source_id)
    assert record is not None and record.poll_interval == timedelta(hours=1)
    assert world.source_id not in world.store.sources.claim_due(
        NOW + timedelta(minutes=59)
    )
    assert world.source_id in world.store.sources.claim_due(NOW + timedelta(hours=1))


# P1-W3-S02: tagging joins the pipeline after segmentation (or the fetch, or discover).
TAG_ANSWER = (
    '{"item": {"difficulty": "intermediate", "concepts": ["write-ahead-log"]},'
    ' "moments": [{"ordinal": 0, "difficulty": "beginner", "concepts": []}]}'
)


class TagLlm:
    provider: AiProvider = "openrouter"

    def __init__(self) -> None:
        self.calls: list[str] = []

    def complete(self, model: str, messages: list[Message]) -> Completion:
        self.calls.append(messages[-1]["content"])
        return Completion(TAG_ANSWER, 800, 60, Decimal("0.001"))


class NoEmbeddings:
    provider: AiProvider = "voyage"

    def embed(
        self, model: str, texts: list[str], purpose: EmbeddingPurpose
    ) -> Embeddings:
        raise AssertionError("no embeddings in tagging")


def tagged_world(
    profile: RightsProfile = "full_text_internal", spent: Decimal = Decimal(0)
) -> tuple[World, TagLlm, InMemoryAi]:
    llm = TagLlm()
    ledger = InMemoryAi(InMemoryStore().users)
    if spent:
        ledger.record(Usage(None, "tagging", "openrouter", "m", 0, 0, spent, NOW))

    @contextmanager
    def gateway() -> Generator[AiGateway]:
        yield AiGateway(ledger, llm, NoEmbeddings(), clock=lambda: NOW)

    world = World(profile=profile, tagging=ModelJob("small-model", gateway))
    sync_concepts(
        world.store,
        parse_concepts(
            "version: 1\nconcepts:\n"
            "  - {slug: write-ahead-log, name: WAL, topic: databases}\n",
            "c.yaml",
        ),
    )
    return world, llm, ledger


def test_each_item_is_tagged_once_with_its_moments() -> None:
    world, llm, _ = tagged_world()
    world.discover("poll-1")
    world.run()
    for item_id in world.store.items.rows:
        tags, _ = world.store.tags.for_item(item_id)
        assert tags is not None and tags.concepts == frozenset({"write-ahead-log"})
    assert len(llm.calls) == 2  # one per item
    world.now = NOW + timedelta(days=2)  # a later full poll
    world.discover("poll-2")
    world.run()
    assert len(llm.calls) == 2  # AI-4: never again at this prompt version


def test_without_a_tagging_model_nothing_is_queued_or_tagged() -> None:
    world = World()
    world.discover()
    world.run()
    assert world.queue.pending("tag_item") == 0
    assert all(world.store.tags.version(i) is None for i in world.store.items.rows)


def test_a_metadata_only_item_is_tagged_from_its_title_and_summary() -> None:
    world, llm, _ = tagged_world(profile="metadata_only")
    world.discover()
    world.run()
    assert len(llm.calls) == 2
    assert "<moment" not in llm.calls[0]


def test_over_budget_tagging_degrades_and_is_retried_by_a_later_poll(
    capsys: pytest.CaptureFixture[str],
) -> None:
    world, llm, ledger = tagged_world(spent=Decimal(1000))
    world.discover("poll-1")
    world.run()
    assert llm.calls == []
    assert world.queue.failed_messages("tag_item") == []
    assert "pipeline: tagging over budget" in capsys.readouterr().out
    ledger.rows.clear()  # the next day's budget
    world.now = NOW + timedelta(days=2)
    world.store.validators.put(FEED_URL, None)  # the daily full poll: no 304
    world.discover("poll-2")
    world.run()
    assert len(llm.calls) == 2


def test_resegmenting_an_item_redoes_its_tags() -> None:
    world, llm, _ = tagged_world()
    world.discover()
    world.run()
    wal = next(i for i in world.store.items.rows.values() if i.canonical_url == WAL)
    assert world.store.tags.version(wal.id) is not None
    world.queue.enqueue(
        "segment_item", {"content_item_id": wal.id}, idempotency_key="again"
    )
    world.run()
    assert world.store.tags.version(wal.id) is not None
    assert len(llm.calls) == 3  # the re-segmented item was tagged again


def test_a_duplicate_item_is_never_tagged() -> None:
    world, llm, _ = tagged_world(profile="metadata_only")
    mirror_url = "https://mirror.example.test/feed.atom"
    mirror = world.store.sources.upsert(
        name="mirror",
        feed_url=mirror_url,
        rights_profile="metadata_only",
        homepage=None,
    )
    world.fetcher = FakeFetcher(
        {
            FEED_URL: Fetched(FEED_URL, fixture_bytes("atom.xml"), "utf-8"),
            mirror_url: Fetched(mirror_url, fixture_bytes("atom.xml"), "utf-8"),
        }
    )
    world.discover()
    world.queue.enqueue("discover_source", {"source_id": mirror}, idempotency_key="m")
    world.run()
    assert len(llm.calls) == 2  # the two primaries; their copies are skipped
    copies = [i for i in world.store.items.rows.values() if i.duplicate_of]
    assert copies and all(world.store.tags.version(i.id) is None for i in copies)


def test_an_excerpt_item_is_tagged_after_its_fetch_from_its_excerpt() -> None:
    world, llm, _ = tagged_world(profile="excerpt")
    world.discover()
    world.run()
    assert len(llm.calls) == 2
    assert "Excerpt:" in llm.calls[0]


# P1-W3-S04: embeddings join after segmentation, like tagging.
class FakeVoyage:
    provider: AiProvider = "voyage"

    def __init__(self) -> None:
        self.texts: list[str] = []

    def embed(
        self, model: str, texts: list[str], purpose: EmbeddingPurpose
    ) -> Embeddings:
        self.texts.extend(texts)
        return Embeddings([[1.0] + [0.0] * 1023 for _ in texts], 5, Decimal("0.0001"))


class NoLlm:
    provider: AiProvider = "openrouter"

    def complete(self, model: str, messages: list[Message]) -> Completion:
        raise AssertionError("no completions here")


def embedding_world(
    profile: RightsProfile = "full_text_internal",
) -> tuple[World, FakeVoyage]:
    voyage = FakeVoyage()
    ledger = InMemoryAi(InMemoryStore().users)

    @contextmanager
    def gateway() -> Generator[AiGateway]:
        yield AiGateway(ledger, NoLlm(), voyage, clock=lambda: NOW)

    return World(profile=profile, embedding=ModelJob("voyage-3.5", gateway)), voyage


def test_every_moment_of_a_full_text_item_is_embedded_once() -> None:
    world, voyage = embedding_world()
    world.discover("poll-1")
    world.run()
    embedded = len(voyage.texts)
    assert embedded == len(world.store.moments.rows) > 0
    assert all(
        not world.store.embeddings.missing(i, "voyage-3.5")
        for i in world.store.items.rows
    )
    world.now = NOW + timedelta(days=2)
    world.store.validators.put(FEED_URL, None)
    world.discover("poll-2")
    world.run()
    assert len(voyage.texts) == embedded  # AI-4: not again


def test_items_without_full_text_rights_get_no_vectors() -> None:
    world, voyage = embedding_world(profile="excerpt")
    world.discover()
    world.run()
    assert voyage.texts == []
    assert world.queue.pending("embed_item") == 0


def test_resegmenting_redoes_the_vectors() -> None:
    world, voyage = embedding_world()
    world.discover()
    world.run()
    wal = next(i for i in world.store.items.rows.values() if i.canonical_url == WAL)
    before = len(voyage.texts)
    world.queue.enqueue(
        "segment_item", {"content_item_id": wal.id}, idempotency_key="again"
    )
    world.run()
    assert len(voyage.texts) > before
    assert not world.store.embeddings.missing(wal.id, "voyage-3.5")


def test_a_moment_with_no_text_does_not_make_every_poll_re_embed() -> None:
    world, voyage = embedding_world()
    world.discover("poll-1")
    world.run()
    wal = next(i for i in world.store.items.rows.values() if i.canonical_url == WAL)
    rows = [m.row for m in world.store.moments.for_item(wal.id)]
    ghost = MomentRow(len(rows), "Not in the text", 1, WAL + "#ghost", "anchor")
    world.store.moments.replace(wal.id, [*rows, ghost])
    world.store.embeddings.clear(wal.id)  # as after a re-segmentation
    for poll in ("poll-2", "poll-3"):
        world.now += timedelta(days=2)
        world.store.validators.put(FEED_URL, None)
        world.discover(poll)
        world.run()
    # Re-embedded once (poll-2), not again on poll-3.
    assert voyage.texts.count(voyage.texts[0]) <= 2
    assert not world.store.embeddings.missing(wal.id, "voyage-3.5")


# Why-this-matters notes (REC-5, AI-4, OPS-4, Q-P1-18, P1-W4-S06).
class NoteLlm:
    provider: AiProvider = "openrouter"

    def __init__(self) -> None:
        self.calls = 0
        self.reply = "A polished note."

    def complete(self, model: str, messages: list[Message]) -> Completion:
        self.calls += 1
        return Completion(self.reply, 100, 10, Decimal("0.0001"))


def notes_world(on: bool = True, spent: Decimal = Decimal(0)) -> tuple[World, NoteLlm]:
    llm = NoteLlm()
    ledger = InMemoryAi(InMemoryStore().users)
    if spent:
        ledger.record(Usage(None, "notes", "openrouter", "m", 0, 0, spent, NOW))

    @contextmanager
    def gateway() -> Generator[AiGateway]:
        yield AiGateway(ledger, llm, NoEmbeddings(), clock=lambda: NOW)

    world = World(notes=ModelJob("small-notes", gateway) if on else None)
    world.store.sources.rows[world.source_id].topics = ("databases",)
    world.store.users.rows["u1"] = StoredUser("u1", is_anonymous=True)
    world.store.ranking.preferences_by_user["u1"] = UserPreferences(
        topics=["databases"], level="intermediate", break_length="3-8"
    )
    world.discover()
    world.run()
    return world, llm


def recompute(world: World, key: str) -> None:
    world.queue.enqueue("recompute_feed", {"user_id": "u1"}, idempotency_key=key)
    world.run()


def test_every_entry_gets_a_note_polished_once_by_the_notes_model() -> None:
    world, llm = notes_world()
    recompute(world, "r-1")
    entries = [e for chip in world.store.feed.users["u1"].values() for e in chip]
    note_ids = {e.note_id for e in entries}
    assert entries and None not in note_ids
    notes = world.store.notes.rows
    assert all(notes[n].model == "small-notes" for n in note_ids if n is not None)
    assert llm.calls == len(note_ids)
    recompute(world, "r-2")  # a cache hit: nothing is polished twice (AI-4)
    assert llm.calls == len(note_ids)


def test_with_notes_off_entries_get_template_notes_and_no_polish() -> None:
    world, llm = notes_world(on=False)
    world.queue.enqueue("recompute_feed", {"user_id": "u1"}, idempotency_key="r-1")
    # The recompute stage alone: what it queued is still pending.
    world.queue.consume(
        "recompute_feed", world.pipeline.handlers()["recompute_feed"], threading.Event()
    )
    entries = world.store.feed.users["u1"]["3-8"]
    notes = world.store.notes.rows
    assert entries and all(e.note_id is not None for e in entries)
    assert all(notes[e.note_id].model is None for e in entries if e.note_id)
    assert world.queue.pending("polish_note") == 0
    assert llm.calls == 0


def test_with_notes_on_the_recompute_queues_each_new_note_once() -> None:
    world, _ = notes_world()
    world.queue.enqueue("recompute_feed", {"user_id": "u1"}, idempotency_key="r-1")
    world.queue.consume(
        "recompute_feed", world.pipeline.handlers()["recompute_feed"], threading.Event()
    )
    queued = world.queue.pending_messages("polish_note")
    assert queued and len({key for key, _ in queued}) == len(queued)


def test_a_refused_reply_is_not_paid_for_again() -> None:
    world, llm = notes_world()
    llm.reply = "Too long. " * 40
    recompute(world, "r-1")
    first = llm.calls
    assert first > 0
    recompute(world, "r-2")
    assert llm.calls == first  # refused once, settled: the template stays


def test_a_polish_over_budget_keeps_the_template(
    capsys: pytest.CaptureFixture[str],
) -> None:
    world, llm = notes_world(spent=Decimal(1000))
    recompute(world, "r-1")
    assert llm.calls == 0
    assert all(n.model is None for n in world.store.notes.rows.values())
    assert "notes: over budget" in capsys.readouterr().out
