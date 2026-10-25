"""Ports (ADR-0012): the only way business logic reaches storage, the web or parsing.

Adapters in `interval_jobs.adapters` implement these; `compose.py` wires them. Logic
never imports a driver or SDK, so a service is swapped by replacing one adapter.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from threading import Event
from typing import Literal, Protocol, TypedDict

from pydantic import BaseModel, ConfigDict

from interval_db.generated import (
    AiFeature,
    AiProvider,
    BetaGroup,
    Capability,
    MomentLinkType,
    RightsProfile,
)
from interval_db.messages import MessageName
from interval_jobs.events.generated import Envelope

type FetchKind = Literal["feed", "article"]


class FetchError(Exception):
    """The fetch was refused or failed (scheme, address, size, type, HTTP status)."""


class FetchStatusError(FetchError):
    """The server answered with an error status."""

    def __init__(self, message: str, status: int) -> None:
        super().__init__(message)
        self.status = status


class RobotsDisallowed(FetchError):
    """robots.txt disallows the URL for Interval (ING-1): skip it, don't retry."""


class ExtractionError(Exception):
    """No main text could be extracted from a page."""


class DuplicateInviteCode(Exception):
    """An invite code with the same normalised value already exists."""


class RightsViolation(Exception):
    """A store refused a write the source's rights profile forbids (ING-2)."""


class FeedEntry(BaseModel):
    """One feed entry, validated at the parsing boundary."""

    model_config = ConfigDict(frozen=True)

    guid: str
    link: str
    title: str
    author: str | None
    published_at: datetime | None
    updated_at: datetime | None
    summary: str | None


@dataclass(frozen=True)
class Validators:
    """The ETag / Last-Modified a URL last answered with (ING-1 conditional requests).
    At least one is set."""

    etag: str | None
    last_modified: str | None


@dataclass(frozen=True)
class Fetched:
    url: str  # final URL after redirects
    body: bytes
    encoding: str | None
    # What the next conditional request sends (ING-1); None when the server sent none.
    validators: Validators | None = None


@dataclass(frozen=True)
class Section:
    """One heading section of an article: structure and counts, never body text."""

    heading: str | None  # None for the intro
    level: int | None
    anchor_id: str | None
    word_count: int


@dataclass(frozen=True)
class SectionRow:
    heading: str | None
    anchor_id: str | None
    word_count: int
    level: int | None  # 1-6; None for the intro or a heading of unknown level


@dataclass(frozen=True)
class MomentRow:
    ordinal: int
    title: str
    estimated_minutes: int
    link: str
    link_type: MomentLinkType
    oversized: bool = False  # over 8 minutes with nowhere to split (Q-P1-06)


@dataclass(frozen=True)
class SourceRecord:
    id: int
    feed_url: str
    rights_profile: RightsProfile
    active: bool  # removed from the seed file: not polled (P1-W2-S01)
    moments_enabled: bool
    poll_interval: timedelta  # ING-3, adapted after every poll
    polled_at: datetime | None  # when it last adapted


@dataclass(frozen=True)
class FetchInput:
    """What the fetch stage needs about an item, with its source's current profile."""

    canonical_url: str
    title: str
    rights_profile: RightsProfile


@dataclass(frozen=True)
class SegmentationInput:
    title: str
    canonical_url: str
    rights_profile: RightsProfile
    moments_enabled: bool


@dataclass(frozen=True)
class SourceSettings:
    """A source's settings from the seed list (Q-P1-02); only sources with a feed."""

    name: str
    homepage: str | None
    feed_url: str
    rights_profile: RightsProfile
    moments_enabled: bool
    paywalled: bool
    quality_score: int | None
    topics: tuple[str, ...]


@dataclass(frozen=True)
class SyncResult:
    added: int
    updated: int
    unchanged: int
    deactivated: int


class Sources(Protocol):
    def get(self, source_id: int) -> SourceRecord | None: ...

    def active_ids(self) -> list[int]:
        """Sources to poll: those still in the seed list (P1-W2-S01)."""
        ...

    def claim_due(self, now: datetime) -> list[int]:
        """Active sources whose next poll is due, in id order; each one's next poll
        moves one interval on, so a second claim before then doesn't return it."""
        ...

    def record_poll(
        self, source_id: int, interval: timedelta, polled_at: datetime
    ) -> None:
        """The adapted interval; the next poll is due one interval after polled_at."""
        ...

    def upsert(
        self,
        *,
        name: str,
        feed_url: str,
        rights_profile: RightsProfile,
        homepage: str | None,
    ) -> int:
        """Lowering a profile removes stored text and moments it no longer allows.
        The source is active afterwards (ingest-one uses it on purpose)."""
        ...

    def sync(self, seeds: list[SourceSettings]) -> SyncResult:
        """Makes the table match the seed list, leaving identical rows untouched.

        A source is found by name, or else by feed URL (a rename, or a row made by
        ingest-one: same feed, same source, owner choice 2026-10-26); it is updated and
        active again. A new one is added. Every source not listed is deactivated,
        never deleted, so its items stay.
        """
        ...


class Items(Protocol):
    """Writes the source's profile forbids raise RightsViolation (ING-2)."""

    def upsert_from_feed(
        self, source_id: int, entry: FeedEntry, keep_excerpt: bool
    ) -> int:
        """Insert or update by (source, guid); drops the excerpt unless kept. An update
        keeps the canonical URL, which the fetch stage may have refined."""
        ...

    def known_guids(self, source_id: int, guids: list[str]) -> set[str]:
        """Which of these feed entries the source already has (ING-3 counts the rest
        as new)."""
        ...

    def set_canonical(self, item_id: int, url: str) -> None: ...

    def set_simhash(self, item_id: int, simhash: int) -> None:
        """Derived from body text, so full-text rights only."""
        ...

    def hold_duplicate_lock(self) -> None:
        """Taken first in a stage that links duplicates, before any row lock, so two
        stages regrouping overlapping items can't deadlock."""
        ...

    def link_duplicates(self, item_id: int) -> int:
        """Links the item and everything it duplicates (Q-P1-08) to the earliest
        published of them, and returns that primary. Duplicates: the same canonical
        URL; or, between two full-text sources, SimHashes within MAX_SIMHASH_DISTANCE;
        or, when either source can't process bodies, the same title, author and UTC
        publication day (a missing author or date never matches). Keyed on rights,
        not on whether a SimHash exists yet, so a link made before the fetch never has
        to be undone."""
        ...

    def set_excerpt(self, item_id: int, excerpt: str) -> None: ...

    def store_full_text(self, item_id: int, text: str) -> None: ...

    def drop_full_text(self, item_id: int) -> None: ...

    def replace_sections(self, item_id: int, sections: list[Section]) -> None: ...

    def for_segmentation(self, item_id: int) -> SegmentationInput | None:
        """Also takes the item's lock for the rest of the unit of work."""
        ...

    def sections(self, item_id: int) -> list[SectionRow]: ...

    def for_fetch(self, item_id: int) -> FetchInput | None: ...

    def has_body(self, item_id: int) -> bool:
        """Whether the item's stored body (full text or excerpt) exists."""
        ...


class Moments(Protocol):
    def exist(self, item_id: int) -> bool: ...

    def replace(self, item_id: int, rows: list[MomentRow]) -> None:
        """Upsert by ordinal (ids stay stable) and remove ordinals no longer present."""
        ...


class Feed(Protocol):
    def rebuild(self) -> int:
        """Recompute the precomputed feed; returns the number of entries."""
        ...


class Invites(Protocol):
    def issue(
        self,
        *,
        beta_group: BetaGroup,
        max_uses: int,
        expires_at: datetime,
        note: str | None,
        codes: list[str],
    ) -> list[str]:
        """Stores the codes normalised (one transaction); raises DuplicateInviteCode."""
        ...


class Users(Protocol):
    def purge_inactive_guests(self, now: datetime) -> int:
        """Deletes anonymous users with no session still valid at `now` (Q-P1-12):
        guests idle for 30 days (sessions slide) and guests who signed out."""
        ...


type GrantResult = Literal["granted", "no_account", "limited"]
type RevokeResult = Literal["revoked", "not_granted", "no_account"]


class Grants(Protocol):
    """Capabilities given to one person on top of their plan (OPS-3, Q-P1-29).

    Emails match an account case- and space-insensitively; guests have none. A
    capability any plan limits can't be granted ("limited"): grants carry no limit.
    """

    def grant(self, email: str, capability: Capability) -> GrantResult:
        """Idempotent: granting twice is "granted" both times."""
        ...

    def revoke(self, email: str, capability: Capability) -> RevokeResult:
        """Removes the grant only; the plan may still give the capability."""
        ...


@dataclass(frozen=True)
class Usage:
    """One model call's cost (OPS-4); user_id is None for offline jobs."""

    user_id: str | None
    feature: AiFeature
    provider: AiProvider
    model: str
    input_tokens: int
    output_tokens: int
    cost_usd: Decimal
    occurred_at: datetime


class AiLedger(Protocol):
    """Budgets and spend for the AI gateway (Q-P1-23).

    Not part of the Store: usage is recorded on its own connection and committed at
    once, because the provider has charged even if the job later fails and rolls back.
    """

    def daily_budget_cents(self, user_id: str | None) -> int | None:
        """A user's plan budget (0 if none granted), or the global budget for None.
        None means no limit."""
        ...

    def spent_usd(self, user_id: str | None, day: date) -> Decimal:
        """Spend on a UTC day: one user's calls, or the offline calls for None."""
        ...

    def record(self, usage: Usage) -> None: ...


# Validators older than this are not sent: one full fetch a day lets discover re-queue
# items whose later stages failed, even when the feed itself hasn't changed.
VALIDATORS_MAX_AGE = timedelta(days=1)


class FetchValidators(Protocol):
    def get(self, url: str) -> Validators | None:
        """None when none are stored or they are older than VALIDATORS_MAX_AGE."""
        ...

    def put(self, url: str, validators: Validators | None) -> None:
        """None forgets the URL's validators (the server stopped sending them)."""
        ...


class Store(Protocol):
    """Repositories sharing one unit of work; the composition root commits it."""

    @property
    def sources(self) -> Sources: ...

    @property
    def items(self) -> Items: ...

    @property
    def moments(self) -> Moments: ...

    @property
    def feed(self) -> Feed: ...

    @property
    def invites(self) -> Invites: ...

    @property
    def users(self) -> Users: ...

    @property
    def grants(self) -> Grants: ...

    @property
    def validators(self) -> FetchValidators: ...


class Fetcher(Protocol):
    def fetch(self, url: str, kind: FetchKind) -> Fetched: ...

    def fetch_if_changed(
        self, url: str, kind: FetchKind, known: Validators | None
    ) -> Fetched | None:
        """None when the server says nothing changed since `known` (a 304)."""
        ...


class Extractor(Protocol):
    def text(self, html: bytes, encoding: str | None) -> str: ...

    def sections(
        self, html: bytes, encoding: str | None, title: str
    ) -> list[Section]: ...


class EventSink(Protocol):
    """Where events go (DB-5): Firehose when deployed, a file in development."""

    def write(self, batch: list[Envelope]) -> list[Envelope]:
        """Returns the events it could not deliver, for one retry."""
        ...


class Message(TypedDict):
    role: Literal["system", "user", "assistant"]
    content: str


@dataclass(frozen=True)
class Completion:
    text: str
    input_tokens: int
    output_tokens: int
    cost_usd: Decimal  # as the provider reports it


@dataclass(frozen=True)
class Embeddings:
    vectors: list[list[float]]
    input_tokens: int
    cost_usd: Decimal


class LlmClient(Protocol):
    """Large-model calls (ADR-0007: OpenRouter). Only ai/gateway.py uses this."""

    @property
    def provider(self) -> AiProvider: ...

    def complete(self, model: str, messages: list[Message]) -> Completion: ...


class EmbeddingClient(Protocol):
    """Embeddings (ADR-0007: Voyage AI). Only ai/gateway.py uses this."""

    @property
    def provider(self) -> AiProvider: ...

    def embed(self, model: str, texts: list[str]) -> Embeddings: ...


@dataclass(frozen=True)
class Delivery:
    attempt: int  # 1 for the first delivery
    # The enqueuer's key (LOAD-5). SQS can deliver a message twice, and two enqueues
    # with one key can both arrive, so handlers dedupe on it.
    idempotency_key: str


class QueueHandler(Protocol):
    """Handles one delivery. Raising means "retry"; after the last attempt the message
    goes to the failed store. Deliveries are at least once, so handlers are idempotent
    (LOAD-5)."""

    def __call__(self, message: BaseModel, delivery: Delivery) -> None: ...


class JobQueue(Protocol):
    """Enqueue side of the queue port (ADR-0014): BullMQ on Valkey or SQS.

    Only what both engines support: no priorities and at most 900 s of delay. The
    idempotency key travels with the message; BullMQ also drops a second enqueue while
    the first is pending, but SQS can't, so consumers dedupe.
    """

    def enqueue(
        self,
        name: MessageName,
        message: Mapping[str, object],
        idempotency_key: str,
        delay_seconds: int = 0,
    ) -> None:
        """Validates the message against its schema (packages/db/messages) first."""
        ...


class QueueConsumer(Protocol):
    def consume(self, name: MessageName, handler: QueueHandler, stop: Event) -> None:
        """Delivers messages of one queue to the handler until `stop` is set."""
        ...
