"""In-memory adapters (ADR-0012): fakes for logic tests, never used in production.

The store contract tests run the same cases against these and the Postgres adapter, so
logic tested here behaves the same against the database. That includes the database's
ING-2 triggers: forbidden writes raise RightsViolation, and lowering a profile or
switching moments off purges what the source no longer allows.
"""

import re
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime
from decimal import Decimal

from interval_db.generated import BetaGroup, Capability, RightsProfile
from interval_jobs.ports import (
    DuplicateInviteCode,
    FeedEntry,
    Fetched,
    FetchError,
    FetchInput,
    FetchKind,
    GrantResult,
    MomentRow,
    RevokeResult,
    RightsViolation,
    Section,
    SectionRow,
    SegmentationInput,
    SourceRecord,
    SourceSettings,
    SyncResult,
    Usage,
)

_FULL_TEXT: frozenset[RightsProfile] = frozenset(
    {"full_text_internal", "full_text_display"}
)


@dataclass
class _Source:
    id: int
    name: str
    feed_url: str
    rights_profile: RightsProfile
    homepage: str | None
    moments_enabled: bool = False
    paywalled: bool = False
    quality_score: int | None = None
    topics: tuple[str, ...] = ()
    active: bool = True


@dataclass
class StoredItem:
    id: int
    source_id: int
    guid: str
    canonical_url: str
    title: str
    author: str | None
    published_at: datetime | None
    feed_summary: str | None
    excerpt: str | None = None
    full_text: str | None = None
    sections: list[Section] = field(default_factory=list[Section])


@dataclass
class StoredMoment:
    id: int
    item_id: int
    row: MomentRow


def _settings_of(row: _Source) -> SourceSettings | None:
    if not row.active:
        return None  # an inactive row always changes: it comes back on
    return SourceSettings(
        name=row.name,
        homepage=row.homepage,
        feed_url=row.feed_url,
        rights_profile=row.rights_profile,
        moments_enabled=row.moments_enabled,
        paywalled=row.paywalled,
        quality_score=row.quality_score,
        topics=row.topics,
    )


class InMemorySources:
    def __init__(self) -> None:
        self.rows: dict[int, _Source] = {}
        self.store: InMemoryStore | None = None  # set by InMemoryStore, for purges

    def get(self, source_id: int) -> SourceRecord | None:
        s = self.rows.get(source_id)
        if s is None:
            return None
        return SourceRecord(
            s.id, s.feed_url, s.rights_profile, s.active, s.moments_enabled
        )

    def active_ids(self) -> list[int]:
        return sorted(s.id for s in self.rows.values() if s.active)

    def upsert(
        self,
        *,
        name: str,
        feed_url: str,
        rights_profile: RightsProfile,
        homepage: str | None,
    ) -> int:
        for s in self.rows.values():
            if s.name == name:
                s.feed_url, s.rights_profile, s.homepage = (
                    feed_url,
                    rights_profile,
                    homepage,
                )
                s.active = True
                self._purge(s)
                return s.id
        if any(s.feed_url == feed_url for s in self.rows.values()):
            raise ValueError(f"feed_url {feed_url} is taken (unique, like Postgres)")
        source_id = len(self.rows) + 1
        self.rows[source_id] = _Source(
            source_id, name, feed_url, rights_profile, homepage
        )
        return source_id

    def sync(self, seeds: list[SourceSettings]) -> SyncResult:
        added = updated = unchanged = 0
        for seed in seeds:
            row = next((r for r in self.rows.values() if r.name == seed.name), None)
            row = row or next(
                (r for r in self.rows.values() if r.feed_url == seed.feed_url), None
            )
            if row is None:
                source_id = len(self.rows) + 1
                self.rows[source_id] = _Source(
                    id=source_id,
                    name=seed.name,
                    feed_url=seed.feed_url,
                    rights_profile=seed.rights_profile,
                    homepage=seed.homepage,
                )
                row = self.rows[source_id]
                added += 1
            elif _settings_of(row) == seed:
                unchanged += 1
                continue
            else:
                updated += 1
            row.name = seed.name
            row.feed_url = seed.feed_url
            row.rights_profile = seed.rights_profile
            row.homepage = seed.homepage
            row.moments_enabled = seed.moments_enabled
            row.paywalled = seed.paywalled
            row.quality_score = seed.quality_score
            row.topics = seed.topics
            row.active = True
            self._purge(row)
        listed = {seed.name for seed in seeds}
        deactivated = 0
        for row in self.rows.values():
            if row.active and row.name not in listed:
                row.active = False
                deactivated += 1
        return SyncResult(added, updated, unchanged, deactivated)

    def set_moments_enabled(self, source_id: int, enabled: bool) -> None:
        self.rows[source_id].moments_enabled = enabled
        self._purge(self.rows[source_id])

    def _purge(self, source: _Source) -> None:
        # Mirrors the purge_text_beyond_profile trigger.
        if self.store is None:
            return
        items = [i for i in self.store.items.rows.values() if i.source_id == source.id]
        for item in items:
            if source.rights_profile not in _FULL_TEXT:
                item.full_text, item.sections = None, []
            if source.rights_profile != "excerpt":
                item.excerpt = None
        if not source.moments_enabled or source.rights_profile not in _FULL_TEXT:
            ids = {i.id for i in items}
            self.store.moments.rows = [
                m for m in self.store.moments.rows if m.item_id not in ids
            ]
            self.store.feed.drop_missing()


class InMemoryItems:
    def __init__(self, sources: InMemorySources) -> None:
        self._sources = sources
        self.rows: dict[int, StoredItem] = {}

    def upsert_from_feed(
        self, source_id: int, entry: FeedEntry, keep_excerpt: bool
    ) -> int:
        for item in self.rows.values():
            if item.source_id == source_id and item.guid == entry.guid:
                item.canonical_url, item.title = entry.link, entry.title
                item.author, item.published_at = entry.author, entry.published_at
                item.feed_summary = entry.summary
                if not keep_excerpt:
                    item.excerpt = None
                return item.id
        item_id = len(self.rows) + 1
        self.rows[item_id] = StoredItem(
            id=item_id,
            source_id=source_id,
            guid=entry.guid,
            canonical_url=entry.link,
            title=entry.title,
            author=entry.author,
            published_at=entry.published_at,
            feed_summary=entry.summary,
        )
        return item_id

    def _profile(self, item_id: int) -> RightsProfile:
        return self._sources.rows[self.rows[item_id].source_id].rights_profile

    def set_excerpt(self, item_id: int, excerpt: str) -> None:
        profile = self._profile(item_id)
        if profile != "excerpt":
            raise RightsViolation(f"rights profile {profile} does not allow an excerpt")
        self.rows[item_id].excerpt = excerpt

    def store_full_text(self, item_id: int, text: str) -> None:
        self._require_full_text(item_id)
        self.rows[item_id].full_text = text

    def _require_full_text(self, item_id: int) -> None:
        profile = self._profile(item_id)
        if profile not in _FULL_TEXT:
            raise RightsViolation(f"rights profile {profile} does not allow full text")

    def drop_full_text(self, item_id: int) -> None:
        self.rows[item_id].full_text = None

    def replace_sections(self, item_id: int, sections: list[Section]) -> None:
        self._require_full_text(item_id)
        self.rows[item_id].sections = list(sections)

    def for_segmentation(self, item_id: int) -> SegmentationInput | None:
        item = self.rows.get(item_id)
        if item is None:
            return None
        source = self._sources.rows[item.source_id]
        return SegmentationInput(
            item.title,
            item.canonical_url,
            source.rights_profile,
            source.moments_enabled,
        )

    def sections(self, item_id: int) -> list[SectionRow]:
        return [
            SectionRow(s.heading, s.anchor_id, s.word_count)
            for s in self.rows[item_id].sections
        ]

    def for_fetch(self, item_id: int) -> FetchInput | None:
        item = self.rows.get(item_id)
        if item is None:
            return None
        source = self._sources.rows[item.source_id]
        return FetchInput(item.canonical_url, item.title, source.rights_profile)

    def has_body(self, item_id: int) -> bool:
        item = self.rows.get(item_id)
        return item is not None and (
            item.full_text is not None or item.excerpt is not None
        )


class InMemoryMoments:
    def exist(self, item_id: int) -> bool:
        return any(m.item_id == item_id for m in self.rows)

    def __init__(self, items: InMemoryItems, sources: InMemorySources) -> None:
        self._items = items
        self._sources = sources
        self.rows: list[StoredMoment] = []
        self._next_id = 1

    def replace(self, item_id: int, rows: list[MomentRow]) -> None:
        source = self._sources.rows[self._items.rows[item_id].source_id]
        if rows and (
            not source.moments_enabled or source.rights_profile not in _FULL_TEXT
        ):
            raise RightsViolation(
                f"source (profile {source.rights_profile}, moments_enabled "
                f"{source.moments_enabled}) does not allow moments"
            )
        existing = {m.row.ordinal: m for m in self.rows if m.item_id == item_id}
        kept: list[StoredMoment] = [m for m in self.rows if m.item_id != item_id]
        for row in rows:
            current = existing.get(row.ordinal)
            if current is None:
                kept.append(StoredMoment(self._next_id, item_id, row))
                self._next_id += 1
            else:
                kept.append(replace(current, row=row))
        self.rows = kept

    def for_item(self, item_id: int) -> list[StoredMoment]:
        return sorted(
            (m for m in self.rows if m.item_id == item_id), key=lambda m: m.row.ordinal
        )


class InMemoryFeed:
    def __init__(self, items: InMemoryItems, moments: InMemoryMoments) -> None:
        self._items = items
        self._moments = moments
        self.entries: list[int] = []  # moment ids in rank order

    def rebuild(self) -> int:
        # Same placeholder order as the Postgres adapter: newest item first (undated
        # last), then higher item id, then reading order.
        def key(m: StoredMoment) -> tuple[bool, float, int, int]:
            item = self._items.rows[m.item_id]
            published = item.published_at.timestamp() if item.published_at else 0.0
            return (item.published_at is None, -published, -item.id, m.row.ordinal)

        self.entries = [m.id for m in sorted(self._moments.rows, key=key)]
        return len(self.entries)

    def drop_missing(self) -> None:
        # Mirrors feed_entry's on-delete cascade from moment.
        live = {m.id for m in self._moments.rows}
        self.entries = [i for i in self.entries if i in live]


@dataclass
class StoredInvite:
    code: str
    beta_group: BetaGroup
    max_uses: int
    expires_at: datetime
    note: str | None
    used_count: int = 0


class InMemoryInvites:
    def __init__(self) -> None:
        self.rows: dict[str, StoredInvite] = {}

    def issue(
        self,
        *,
        beta_group: BetaGroup,
        max_uses: int,
        expires_at: datetime,
        note: str | None,
        codes: list[str],
    ) -> list[str]:
        # Mirrors normalize_invite_code() in SQL (Postgres \\s is ASCII whitespace)
        # and its length check; all or nothing, like the transaction.
        normalised = [re.sub(r"[ \t\n\r\f\v-]", "", c).upper() for c in codes]
        if any(len(c) < 10 for c in normalised):
            raise ValueError("invite codes have at least 10 characters")
        if len(set(normalised)) != len(normalised) or set(normalised) & set(self.rows):
            raise DuplicateInviteCode("invite code already exists")
        for code in normalised:
            self.rows[code] = StoredInvite(code, beta_group, max_uses, expires_at, note)
        return normalised


@dataclass
class StoredUser:
    id: str
    is_anonymous: bool
    session_expiries: list[datetime] = field(default_factory=list[datetime])
    email: str = ""
    capabilities: set[Capability] = field(default_factory=set[Capability])


class InMemoryUsers:
    def __init__(self) -> None:
        self.rows: dict[str, StoredUser] = {}

    def purge_inactive_guests(self, now: datetime) -> int:
        inactive = [
            u.id
            for u in self.rows.values()
            if u.is_anonymous and not any(e > now for e in u.session_expiries)
        ]
        for user_id in inactive:
            del self.rows[user_id]
        return len(inactive)


# The migration's seed: capabilities the beta plan limits (a database trigger refuses
# granting these; the fake mirrors it).
LIMITED_CAPABILITIES: frozenset[Capability] = frozenset(
    {"ai.notes.daily", "ai.budget.daily_cents"}
)


class InMemoryGrants:
    def __init__(self, users: InMemoryUsers) -> None:
        self._users = users

    def _account(self, email: str) -> StoredUser | None:
        wanted = email.strip().lower()
        return next(
            (
                u
                for u in self._users.rows.values()
                if u.email == wanted and not u.is_anonymous
            ),
            None,
        )

    def grant(self, email: str, capability: Capability) -> GrantResult:
        user = self._account(email)
        if user is None:
            return "no_account"
        if capability in LIMITED_CAPABILITIES:
            return "limited"
        user.capabilities.add(capability)
        return "granted"

    def revoke(self, email: str, capability: Capability) -> RevokeResult:
        user = self._account(email)
        if user is None:
            return "no_account"
        if capability not in user.capabilities:
            return "not_granted"
        user.capabilities.discard(capability)
        return "revoked"


# The migrations' seeds: the beta plan's per-user budget and the global offline budget.
BETA_DAILY_BUDGET_CENTS = 50
GLOBAL_DAILY_BUDGET_CENTS = 500


class InMemoryAi:
    def __init__(self, users: InMemoryUsers) -> None:
        self._users = users
        self.rows: list[Usage] = []

    def daily_budget_cents(self, user_id: str | None) -> int | None:
        if user_id is None:
            return GLOBAL_DAILY_BUDGET_CENTS
        return BETA_DAILY_BUDGET_CENTS if user_id in self._users.rows else 0

    def spent_usd(self, user_id: str | None, day: date) -> Decimal:
        return sum(
            (
                u.cost_usd
                for u in self.rows
                if u.user_id == user_id and u.occurred_at.astimezone(UTC).date() == day
            ),
            Decimal(0),
        )

    def record(self, usage: Usage) -> None:
        # Postgres stores numeric(12, 6); round the same way so both sum alike.
        cost = usage.cost_usd.quantize(Decimal("0.000001"))
        self.rows.append(replace(usage, cost_usd=cost))


class InMemoryStore:
    def __init__(self) -> None:
        self.sources = InMemorySources()
        self.items = InMemoryItems(self.sources)
        self.moments = InMemoryMoments(self.items, self.sources)
        self.feed = InMemoryFeed(self.items, self.moments)
        self.invites = InMemoryInvites()
        self.users = InMemoryUsers()
        self.grants = InMemoryGrants(self.users)
        self.sources.store = self


class FakeFetcher:
    """Serves canned responses by URL and records every request."""

    def __init__(self, pages: dict[str, Fetched | FetchError]) -> None:
        self._pages = pages
        self.requested: list[tuple[str, FetchKind]] = []

    def fetch(self, url: str, kind: FetchKind) -> Fetched:
        self.requested.append((url, kind))
        page = self._pages.get(url)
        if page is None:
            raise FetchError(f"no fake page for {url}")
        if isinstance(page, FetchError):
            raise page
        return page
