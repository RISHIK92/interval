"""Ports (ADR-0012): the only way business logic reaches storage, the web or parsing.

Adapters in `interval_jobs.adapters` implement these; `compose.py` wires them. Logic
never imports a driver or SDK, so a service is swapped by replacing one adapter.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict

from interval_db.generated import BetaGroup, MomentLinkType, RightsProfile
from interval_jobs.events.generated import Envelope

type FetchKind = Literal["feed", "article"]


class FetchError(Exception):
    """The fetch was refused or failed (scheme, address, size, type, HTTP status)."""


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
class Fetched:
    url: str  # final URL after redirects
    body: bytes
    encoding: str | None


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


@dataclass(frozen=True)
class MomentRow:
    ordinal: int
    title: str
    estimated_minutes: int
    link: str
    link_type: MomentLinkType


@dataclass(frozen=True)
class SourceRecord:
    id: int
    feed_url: str
    rights_profile: RightsProfile


@dataclass(frozen=True)
class SegmentationInput:
    title: str
    canonical_url: str
    rights_profile: RightsProfile
    moments_enabled: bool


class Sources(Protocol):
    def get(self, source_id: int) -> SourceRecord | None: ...

    def upsert(
        self,
        *,
        name: str,
        feed_url: str,
        rights_profile: RightsProfile,
        homepage: str | None,
    ) -> int:
        """Lowering a profile removes stored text and moments it no longer allows."""
        ...


class Items(Protocol):
    """Writes the source's profile forbids raise RightsViolation (ING-2)."""

    def upsert_from_feed(
        self, source_id: int, entry: FeedEntry, keep_excerpt: bool
    ) -> int:
        """Insert or update by (source, guid); drops the excerpt unless kept."""
        ...

    def set_excerpt(self, item_id: int, excerpt: str) -> None: ...

    def store_full_text(self, item_id: int, text: str) -> None: ...

    def drop_full_text(self, item_id: int) -> None: ...

    def replace_sections(self, item_id: int, sections: list[Section]) -> None: ...

    def for_segmentation(self, item_id: int) -> SegmentationInput | None:
        """Also takes the item's lock for the rest of the unit of work."""
        ...

    def sections(self, item_id: int) -> list[SectionRow]: ...


class Moments(Protocol):
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


class Fetcher(Protocol):
    def fetch(self, url: str, kind: FetchKind) -> Fetched: ...


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
