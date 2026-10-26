"""In-memory adapters (ADR-0012): fakes for logic tests, never used in production.

The store contract tests run the same cases against these and the Postgres adapter, so
logic tested here behaves the same against the database. That includes the database's
ING-2 triggers: forbidden writes raise RightsViolation, and lowering a profile or
switching moments off purges what the source no longer allows.
"""

import math
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from interval_db.generated import (
    BetaGroup,
    BreakLength,
    Capability,
    Difficulty,
    RightsProfile,
    Topic,
)
from interval_jobs.concepts.graph import refuse_cycles
from interval_jobs.normalize import near_duplicates
from interval_jobs.polling import START_INTERVAL
from interval_jobs.ports import (
    VALIDATORS_MAX_AGE,
    Arm,
    ArmOutcome,
    CandidateArticle,
    CandidateMoment,
    ConceptGraph,
    ConceptSeed,
    DuplicateInviteCode,
    EntryFacts,
    FeedEntry,
    Fetched,
    FetchError,
    FetchInput,
    FetchKind,
    Finished,
    GrantResult,
    MomentLink,
    MomentRow,
    NoteInput,
    NoteKey,
    NoteRef,
    RankedEntry,
    RevokeResult,
    RightsViolation,
    Section,
    SectionRow,
    SegmentationInput,
    SimilarMoment,
    SourceRecord,
    SourceSettings,
    SyncResult,
    TagInput,
    TagMoment,
    TagResult,
    Tags,
    Usage,
    UserPreferences,
    Validators,
)
from interval_jobs.segment import minutes

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
    moments_seeded: bool = False
    moments_switched_off: bool = False  # an admin's switch (P1-W3-S06)
    poll_interval: timedelta = START_INTERVAL
    # Due at once (Postgres: now() at insert; tests claim at or after it).
    next_poll_at: datetime = datetime(1970, 1, 1, tzinfo=UTC)
    polled_at: datetime | None = None


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
    duplicate_of: int | None = None
    simhash: int | None = None


def _title_key(title: str) -> str:
    # Mirrors the SQL item_title_key: ASCII whitespace only, as Postgres's \s.
    return re.sub(r"[ \t\n\r\f\v]+", " ", title).strip(" ").lower()


def _same_metadata(a: StoredItem, b: StoredItem) -> bool:
    def title(item: StoredItem) -> str:
        return _title_key(item.title)

    def day(item: StoredItem) -> date | None:
        return item.published_at.astimezone(UTC).date() if item.published_at else None

    return (
        title(a) == title(b)
        and a.author is not None
        and b.author is not None
        and a.author.lower() == b.author.lower()
        and day(a) is not None
        and day(a) == day(b)
    )


def _publication_order(item: StoredItem) -> tuple[bool, float, int]:
    published = item.published_at.timestamp() if item.published_at else 0.0
    return (item.published_at is None, published, item.id)


def _earlier(a: StoredItem, b: StoredItem) -> bool:
    return _publication_order(a) < _publication_order(b)


def _duplicates(a: StoredItem, b: StoredItem, both_full_text: bool) -> bool:
    # Mirrors PostgresItems.link_duplicates.
    if a.id == b.id or a.canonical_url == b.canonical_url:
        return True
    if both_full_text:
        return (
            a.simhash is not None
            and b.simhash is not None
            and near_duplicates(a.simhash, b.simhash)
        )
    return _same_metadata(a, b)


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
        moments_enabled=row.moments_seeded,
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
            s.id,
            s.feed_url,
            s.rights_profile,
            s.active,
            s.moments_enabled,
            s.poll_interval,
            s.polled_at,
        )

    def active_ids(self) -> list[int]:
        return sorted(s.id for s in self.rows.values() if s.active)

    def claim_due(self, now: datetime) -> list[int]:
        due = sorted(
            s.id for s in self.rows.values() if s.active and s.next_poll_at <= now
        )
        for source_id in due:
            source = self.rows[source_id]
            source.next_poll_at = now + source.poll_interval
        return due

    def record_poll(
        self, source_id: int, interval: timedelta, polled_at: datetime
    ) -> None:
        source = self.rows[source_id]
        source.poll_interval, source.polled_at = interval, polled_at
        source.next_poll_at = polled_at + interval

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
            row.moments_seeded = seed.moments_enabled
            row.moments_enabled = seed.moments_enabled and not row.moments_switched_off
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

    def switch_moments_off(self, source_id: int, off: bool) -> None:
        """What the web admin page does (P1-W3-S06); not part of the worker's port."""
        source = self.rows[source_id]
        source.moments_switched_off = off
        source.moments_enabled = source.moments_seeded and not off
        self._purge(source)

    def set_moments_enabled(self, source_id: int, enabled: bool) -> None:
        # As the seed file would (the switch rule holds: P1-W3-S06).
        self.rows[source_id].moments_seeded = enabled
        self.rows[source_id].moments_enabled = enabled and not (
            self.rows[source_id].moments_switched_off
        )
        self._purge(self.rows[source_id])

    def _purge(self, source: _Source) -> None:
        # Mirrors the purge_text_beyond_profile trigger.
        if self.store is None:
            return
        items = [i for i in self.store.items.rows.values() if i.source_id == source.id]
        for item in items:
            if source.rights_profile not in _FULL_TEXT:
                item.full_text, item.sections, item.simhash = None, [], None
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
        self.boundary_overrides: dict[int, list[str]] = {}  # written by the web app

    def upsert_from_feed(
        self, source_id: int, entry: FeedEntry, keep_excerpt: bool
    ) -> int:
        for item in self.rows.values():
            if item.source_id == source_id and item.guid == entry.guid:
                item.title = entry.title
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

    def known_guids(self, source_id: int, guids: list[str]) -> set[str]:
        wanted = set(guids)
        return {
            i.guid
            for i in self.rows.values()
            if i.source_id == source_id and i.guid in wanted
        }

    def set_canonical(self, item_id: int, url: str) -> None:
        self.rows[item_id].canonical_url = url

    def set_simhash(self, item_id: int, simhash: int) -> None:
        self._require_full_text(item_id)
        self.rows[item_id].simhash = simhash

    def hold_duplicate_lock(self) -> None:
        pass  # one thread at a time in tests

    def link_duplicates(self, item_id: int) -> int:
        me = self.rows[item_id]
        mine = self._profile(item_id) in _FULL_TEXT
        matches = {
            i.id
            for i in self.rows.values()
            if _duplicates(me, i, mine and self._profile(i.id) in _FULL_TEXT)
        }
        roots = matches | {
            p for i in matches if (p := self.rows[i].duplicate_of) is not None
        }
        group = roots | {i.id for i in self.rows.values() if i.duplicate_of in roots}
        primary = min((self.rows[i] for i in group), key=_publication_order).id
        for i in group:
            self.rows[i].duplicate_of = None if i == primary else primary
        return primary

    def profile(self, item_id: int) -> RightsProfile:
        return self._profile(item_id)

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
            SectionRow(s.heading, s.anchor_id, s.word_count, s.level)
            for s in self.rows[item_id].sections
        ]

    def boundary_override(self, item_id: int) -> list[str] | None:
        return self.boundary_overrides.get(item_id)

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
        # The store points this at the feed: deleted moments cascade, as in Postgres.
        self.on_delete: Callable[[], None] = lambda: None

    def links(self, source_id: int | None) -> list[MomentLink]:
        found: list[tuple[tuple[int, int, int], MomentLink]] = []
        for m in self.rows:
            item = self._items.rows[m.item_id]
            source = self._sources.rows[item.source_id]
            if source.moments_enabled and source_id in (None, item.source_id):
                found.append(
                    (
                        (item.source_id, m.item_id, m.row.ordinal),
                        MomentLink(
                            m.id,
                            m.item_id,
                            item.source_id,
                            source.name,
                            m.row.title,
                            m.row.link,
                            m.row.link_type,
                        ),
                    )
                )
        return [link for _, link in sorted(found, key=lambda pair: pair[0])]

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
        self.on_delete()

    def for_item(self, item_id: int) -> list[StoredMoment]:
        return sorted(
            (m for m in self.rows if m.item_id == item_id), key=lambda m: m.row.ordinal
        )


@dataclass
class StoredNote:
    key: NoteKey
    text: str
    model: str | None = None
    tried: bool = False  # polished, or the reply was refused


class InMemoryNotes:
    def __init__(self, items: InMemoryItems, sources: InMemorySources) -> None:
        self._items = items
        self._sources = sources
        self.rows: dict[int, StoredNote] = {}
        self._next_id = 1

    def ensure_all(self, texts: Mapping[NoteKey, str]) -> dict[NoteKey, NoteRef]:
        by_key = {note.key: note_id for note_id, note in self.rows.items()}
        refs: dict[NoteKey, NoteRef] = {}
        for key, text in texts.items():
            note_id = by_key.get(key)
            if note_id is None:
                note_id = self._next_id
                self._next_id += 1
                self.rows[note_id] = StoredNote(key, text)
            refs[key] = NoteRef(note_id, not self.rows[note_id].tried)
        return refs

    def input(self, note_id: int) -> NoteInput | None:
        note = self.rows.get(note_id)
        if note is None or note.tried:
            return None
        item = self._items.rows[note.key.item_id]
        source = self._sources.rows[item.source_id]
        return NoteInput(note_id, item.title, source.name, note.text)

    def polish(self, note_id: int, text: str | None, model: str) -> None:
        note = self.rows[note_id]
        if note.tried:
            return
        note.tried = True
        if text is not None:
            note.text, note.model = text, model


class InMemoryFeed:
    def __init__(self, users: "InMemoryUsers", moments: InMemoryMoments) -> None:
        self._users = users
        self._moments = moments
        self.users: dict[str, dict[BreakLength, list[RankedEntry]]] = {}
        self.computed: dict[str, datetime] = {}
        self.starters: dict[tuple[str, Difficulty, BreakLength], list[RankedEntry]] = {}

    def hold_user(self, user_id: str) -> None:
        pass  # one thread at a time in the fake

    def replace_user(
        self,
        user_id: str,
        by_chip: Mapping[BreakLength, list[RankedEntry]],
        computed_at: datetime,
    ) -> None:
        for ranked in by_chip.values():
            entries = [(r.item_id, r.moment_id) for r in ranked]
            if len(set(entries)) != len(entries):
                raise ValueError("an entry twice in one feed (a unique index refuses)")
        if user_id not in self._users.rows:
            return
        self.users[user_id] = {
            chip: self._live(ranked) for chip, ranked in by_chip.items()
        }
        self.computed[user_id] = computed_at

    def _live(self, ranked: list[RankedEntry]) -> list[RankedEntry]:
        # Items are never deleted here, so only moments can have gone.
        moments = {m.id for m in self._moments.rows}
        return [r for r in ranked if r.moment_id is None or r.moment_id in moments]

    def replace_starter(
        self,
        topic: str,
        level: Difficulty,
        chip: BreakLength,
        ranked: list[RankedEntry],
    ) -> None:
        self.starters[(topic, level, chip)] = self._live(ranked)

    def active_users(self, since: datetime) -> list[str]:
        return sorted(
            u.id
            for u in self._users.rows.values()
            if u.session_expiries
            and u.session_seen is not None
            and u.session_seen >= since
        )

    def drop_missing(self) -> None:
        # Mirrors the on-delete cascade from moment to every feed table.
        for chips in self.users.values():
            for chip, rows in chips.items():
                chips[chip] = self._live(rows)
        for key, rows in self.starters.items():
            self.starters[key] = self._live(rows)


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
    session_seen: datetime | None = None  # the auth session's updated_at


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


class InMemoryValidators:
    def __init__(self) -> None:
        self.rows: dict[str, tuple[Validators, datetime]] = {}  # with when stored

    def get(self, url: str) -> Validators | None:
        row = self.rows.get(url)
        if row is None or datetime.now(UTC) - row[1] > VALIDATORS_MAX_AGE:
            return None
        return row[0]

    def put(self, url: str, validators: Validators | None) -> None:
        if validators is None:
            self.rows.pop(url, None)
        else:
            self.rows[url] = (validators, datetime.now(UTC))


class InMemoryConcepts:
    def __init__(self) -> None:
        self.graph: ConceptGraph | None = None

    def state(self) -> ConceptGraph | None:
        return self.graph

    def apply(self, graph: ConceptGraph) -> None:
        # Mirrors the refuse_prerequisite_cycle trigger.
        refuse_cycles("store", graph.edges)
        versions = [graph.version] + ([self.graph.version] if self.graph else [])
        self.graph = replace(graph, version=max(versions))

    def get(self, slug: str) -> ConceptSeed | None:
        if self.graph is None:
            return None
        return next((c for c in self.graph.concepts if c.slug == slug), None)

    def prerequisites(self, slug: str) -> set[str]:
        if self.graph is None:
            return set()
        before: dict[str, set[str]] = {}
        for source, target, kind in self.graph.edges:
            if kind == "prerequisite_of":
                before.setdefault(target, set()).add(source)
        found: set[str] = set()
        todo = [slug]
        while todo:
            for source in before.get(todo.pop(), set()) - found:
                found.add(source)
                todo.append(source)
        retired = {c.slug for c in self.graph.concepts if c.retired}
        return found - retired


class InMemoryItemTags:
    def __init__(self, items: InMemoryItems, moments: InMemoryMoments) -> None:
        self._items = items
        self._moments = moments
        # item id -> (item tags, moment tags by moment id, model, prompt version)
        self.rows: dict[int, tuple[Tags, dict[int, Tags], str, int]] = {}
        # The web admin page writes these: (item id, moment heading) -> level, and an
        # item's corrected concepts
        self.overrides: dict[tuple[int, str], Difficulty] = {}
        self.item_concept_overrides: dict[int, frozenset[str]] = {}

    def input(self, item_id: int) -> TagInput | None:
        item = self._items.rows.get(item_id)
        if item is None:
            return None
        moments = [
            TagMoment(
                m.id,
                m.row.ordinal,
                None if m.row.link_type == "page_top" else m.row.title,
            )
            for m in self._moments.for_item(item_id)
        ]
        profile = self._items.profile(item_id)
        return TagInput(
            item.title,
            item.feed_summary,
            item.full_text if profile in _FULL_TEXT else None,
            item.excerpt if profile == "excerpt" else None,
            moments,
            self.version(item_id),
            item.duplicate_of is not None,
        )

    def version(self, item_id: int) -> int | None:
        row = self.rows.get(item_id)
        return None if row is None else row[3]

    def moment_difficulty(self, item_id: int, moment_id: int) -> Difficulty | None:
        # An admin's correction wins over the model's level (P1-W3-S05).
        moment = next(m for m in self._moments.for_item(item_id) if m.id == moment_id)
        if moment.row.link_type != "page_top":
            corrected = self.overrides.get((item_id, moment.row.title))
            if corrected is not None:
                return corrected
        row = self.rows.get(item_id)
        tags = row[1].get(moment_id) if row else None
        return tags.difficulty if tags else None

    def needs_tagging(self, item_id: int, prompt_version: int) -> bool:
        item = self._items.rows[item_id]
        return item.duplicate_of is None and self.version(item_id) != prompt_version

    def clear(self, item_id: int) -> None:
        self.rows.pop(item_id, None)

    def find(self, canonical_url: str) -> int | None:
        matches = sorted(
            (i.duplicate_of is not None, i.id)
            for i in self._items.rows.values()
            if i.canonical_url == canonical_url
        )
        return matches[0][1] if matches else None

    def save(
        self, item_id: int, result: TagResult, model: str, prompt_version: int
    ) -> None:
        live = {m.id for m in self._moments.for_item(item_id)}
        foreign = sorted(set(result.moments) - live)
        if foreign:
            raise ValueError(f"moments {foreign} are not item {item_id}'s")
        self.rows[item_id] = (result.item, dict(result.moments), model, prompt_version)

    def for_item(self, item_id: int) -> tuple[Tags | None, dict[int, Tags]]:
        row = self.rows.get(item_id)
        if row is None:
            return None, {}
        ordinals = {m.id: m.row.ordinal for m in self._moments.for_item(item_id)}
        return row[0], {ordinals[k]: v for k, v in row[1].items() if k in ordinals}


class InMemoryEmbeddings:
    def __init__(
        self,
        items: InMemoryItems,
        sources: InMemorySources,
        moments: InMemoryMoments,
        tags: InMemoryItemTags,
    ) -> None:
        self._items = items
        self._sources = sources
        self._moments = moments
        self._tags = tags
        self.rows: dict[int, tuple[str, list[float]]] = {}  # moment id -> model, vector
        self.complete: set[tuple[int, str]] = set()  # (item id, model)
        self.store: InMemoryStore | None = None  # set by InMemoryStore

    def missing(self, item_id: int, model: str) -> bool:
        return (
            self._items.rows[item_id].duplicate_of is None
            and bool(self._moments.for_item(item_id))
            and (item_id, model) not in self.complete
        )

    def done(self, item_id: int, model: str) -> set[int]:
        return {
            m.id
            for m in self._moments.for_item(item_id)
            if self.rows.get(m.id, ("", []))[0] == model
        }

    def save(
        self,
        item_id: int,
        vectors: dict[int, list[float]],
        model: str,
        *,
        complete: bool,
    ) -> None:
        owned = {m.id for m in self._moments.for_item(item_id)}
        foreign = sorted(set(vectors) - owned)
        if foreign:
            raise ValueError(f"moments {foreign} are not item {item_id}'s")
        for moment_id, vector in vectors.items():
            self.rows[moment_id] = (model, vector)
        if complete:
            self.complete.add((item_id, model))

    def vectors_of_item(self, item_id: int, model: str) -> list[list[float]]:
        return [
            vector
            for m in self._moments.for_item(item_id)
            for their_model, vector in [self.rows.get(m.id, ("", []))]
            if their_model == model
        ]

    def clear(self, item_id: int) -> None:
        for m in self._moments.for_item(item_id):
            self.rows.pop(m.id, None)
        self.complete = {(i, m) for i, m in self.complete if i != item_id}

    def similar(
        self,
        vector: list[float],
        limit: int,
        *,
        source_ids: list[int] | None = None,
        difficulties: list[Difficulty] | None = None,
        model: str | None = None,
        exclude_sources: set[int] | None = None,
        exclude_items: set[int] | None = None,
        exclude_moments: frozenset[int] = frozenset(),
    ) -> list[SimilarMoment]:
        # Mirrors PostgresEmbeddings.similar; vectors of purged moments are gone.
        live = {m.id: m.item_id for m in self._moments.rows}
        shown = shown_items(self.store) if self.store is not None else None
        hits: list[SimilarMoment] = []
        for moment_id, (their_model, other) in self.rows.items():
            item_id = live.get(moment_id)
            if item_id is None or (model is not None and their_model != model):
                continue
            if moment_id in exclude_moments:
                continue
            source = self._sources.rows[self._items.rows[item_id].source_id]
            if source.rights_profile not in _FULL_TEXT or not source.active:
                continue
            if shown is not None and item_id not in shown:
                continue
            if item_id in (exclude_items or set()) or source.id in (
                exclude_sources or set()
            ):
                continue
            if source_ids is not None and source.id not in source_ids:
                continue
            level = self._tags.moment_difficulty(item_id, moment_id)
            if difficulties is not None and level not in difficulties:
                continue
            score = _cosine(vector, other)
            hits.append(SimilarMoment(moment_id, item_id, source.id, score))
        hits.sort(key=lambda h: -h.score)
        return hits[:limit]


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    norm = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return dot / norm if norm else 0.0


# The rows the ranking_config migration seeds; tests change their own copy.
RANKING_DEFAULTS: dict[str, float] = {
    "weight.topic_match": 1.0,
    "weight.level_fit": 0.6,
    "weight.quality": 0.4,
    "weight.freshness": 0.5,
    "weight.time_fit": 0.7,
    "penalty.less_like_this": 1.0,
    "penalty.not_interested_concepts": 0.8,
    "freshness.half_life_days": 14,
    "mmr.lambda": 0.7,
    "cap.per_source": 4,
    "explore.share": 0.1,
}


def shown_items(store: "InMemoryStore") -> set[int]:
    """Per duplicate group, the earliest copy that has moments: what the feed shows
    (owner review, 2026-10-26), and so what ranking may offer. Mirrors the SQL."""
    with_moments = {m.item_id for m in store.moments.rows}
    best: dict[int, StoredItem] = {}
    for item_id in with_moments:
        item = store.items.rows[item_id]
        group = item.duplicate_of or item.id
        current = best.get(group)
        if current is None or _earlier(item, current):
            best[group] = item
    return {item.id for item in best.values()}


def shown_articles(store: "InMemoryStore") -> set[int]:
    """Per duplicate group, the copy the feed shows as a whole article: the one whose
    moments it shows, else the earliest copy. Mirrors the SQL."""
    with_moments = {m.item_id for m in store.moments.rows}

    def order(item: StoredItem) -> tuple[bool, tuple[bool, float, int]]:
        return (item.id not in with_moments, _publication_order(item))

    best: dict[int, StoredItem] = {}
    for item in store.items.rows.values():
        group = item.duplicate_of or item.id
        current = best.get(group)
        if current is None or order(item) < order(current):
            best[group] = item
    return {item.id for item in best.values()}


class InMemoryRankingInputs:
    """What ranking reads about a user (P1-W4-S02); the web app writes it in
    production, tests set it here."""

    def __init__(self, store: "InMemoryStore") -> None:
        self._store = store
        self.preferences_by_user: dict[str, UserPreferences] = {}
        self.hidden: set[tuple[str, int]] = set()  # (user, source id)
        # (user, item id, kind), oldest first: the order Postgres reads by given_at
        self.feedback: list[tuple[str, int, str]] = []
        self.saves: list[tuple[str, int]] = []  # (user, item), oldest first
        # A reset of inferred interests (P1-W4-S08): how much of `feedback` came before.
        self.resets: dict[str, int] = {}
        self.outcomes: dict[Arm, ArmOutcome] = {}
        # (user, moment) and (user, item): the web app writes them in production.
        self.finished_moments: set[tuple[str, int]] = set()
        self.finished_items: set[tuple[str, int]] = set()
        # The ranking_config migration's seed values (P1-W4-S03)
        self.config_rows: dict[str, float] = dict(RANKING_DEFAULTS)

    def preferences(self, user_id: str) -> UserPreferences | None:
        return self.preferences_by_user.get(user_id)

    def hidden_sources(self, user_id: str) -> set[int]:
        return {source for (user, source) in self.hidden if user == user_id}

    def not_interested(self, user_id: str) -> set[int]:
        return {
            item
            for user, item, kind in self.feedback
            if user == user_id and kind == "not_interested"
        }

    def anchor_items(self, user_id: str, limit: int) -> list[int]:
        liked = [
            item
            for user, item, kind in reversed(self.feedback)
            if user == user_id and kind == "more_like_this"
        ]
        saved = [item for user, item in reversed(self.saves) if user == user_id]
        return list(dict.fromkeys(liked + saved))[:limit]

    def less_liked(self, user_id: str) -> set[int]:
        return {
            item
            for user, item, kind in self.feedback
            if user == user_id and kind == "less_like_this"
        }

    def avoided_concepts(self, user_id: str) -> frozenset[str]:
        # Mirrors the user_avoided_concept view: only Not interested since the reset.
        since = self.resets.get(user_id, 0)
        return frozenset(
            concept
            for user, item, kind in self.feedback[since:]
            if user == user_id and kind == "not_interested"
            for concept in self._item_concepts(item)
        )

    def config(self) -> dict[str, float]:
        return dict(self.config_rows)

    def arm_outcomes(self) -> dict[Arm, ArmOutcome]:
        return dict(self.outcomes)

    def finished(self, user_id: str) -> Finished:
        return Finished(
            frozenset(m for u, m in self.finished_moments if u == user_id),
            frozenset(i for u, i in self.finished_items if u == user_id),
        )

    def moment_facts(self, moment_ids: list[int]) -> dict[int, EntryFacts]:
        # Mirrors PostgresRankingInputs.moment_facts.
        store = self._store
        wanted = set(moment_ids)
        facts: dict[int, EntryFacts] = {}
        graph = store.concepts.state()
        topic_of = {c.slug: c.topic for c in graph.concepts} if graph else {}
        for moment in store.moments.rows:
            if moment.id not in wanted:
                continue
            item = store.items.rows[moment.item_id]
            source = store.sources.rows[item.source_id]
            # The raw row: for_item keys moment tags by ordinal, this by moment id.
            tagged = store.tags.rows.get(item.id)
            item_tags = tagged[0] if tagged else None
            moment_tags = tagged[1] if tagged else {}
            heading_fix = (
                store.tags.overrides.get((item.id, moment.row.title))
                if moment.row.link_type != "page_top"
                else None
            )
            model_moment = moment_tags.get(moment.id)
            # Human before model (owner, 2026-10-26), as PostgresRankingInputs reads.
            difficulty = (
                heading_fix
                or store.tags.overrides.get((item.id, ""))
                or (model_moment.difficulty if model_moment else None)
                or (item_tags.difficulty if item_tags else None)
            )
            concepts = self._item_concepts(item.id)
            topics = set(source.topics) | {
                topic_of[c] for c in concepts if c in topic_of
            }
            facts[moment.id] = EntryFacts(
                moment.id,
                item.id,
                source.id,
                moment.row.estimated_minutes,
                difficulty,
                item.published_at,
                source.quality_score,
                concepts,
                frozenset(topics),
                source.name,
            )
        return facts

    def article_facts(self, item_ids: list[int]) -> dict[int, EntryFacts]:
        # Mirrors PostgresRankingInputs.article_facts.
        store = self._store
        graph = store.concepts.state()
        topic_of = {c.slug: c.topic for c in graph.concepts} if graph else {}
        facts: dict[int, EntryFacts] = {}
        for item_id in item_ids:
            item = store.items.rows.get(item_id)
            if item is None:
                continue
            source = store.sources.rows[item.source_id]
            tagged = store.tags.rows.get(item.id)
            difficulty = store.tags.overrides.get((item.id, "")) or (
                tagged[0].difficulty if tagged and tagged[0] else None
            )
            words = sum(section.word_count for section in item.sections)
            concepts = self._item_concepts(item.id)
            topics = set(source.topics) | {
                topic_of[c] for c in concepts if c in topic_of
            }
            facts[item.id] = EntryFacts(
                None,
                item.id,
                source.id,
                minutes(words) if item.sections else None,
                difficulty,
                item.published_at,
                source.quality_score,
                concepts,
                frozenset(topics),
                source.name,
            )
        return facts

    def topic_articles(
        self,
        topics: list[Topic],
        limit: int,
        *,
        exclude_sources: set[int],
        exclude_items: set[int],
    ) -> list[CandidateArticle]:
        # Mirrors PostgresRankingInputs.topic_articles.
        store = self._store
        graph = store.concepts.state()
        topic_of = {c.slug: c.topic for c in graph.concepts} if graph else {}
        wanted = set(topics)
        shown = shown_articles(store)
        found: list[tuple[bool, float, int, CandidateArticle]] = []
        for item in store.items.rows.values():
            source = store.sources.rows[item.source_id]
            if item.id not in shown or not source.active:
                continue
            if source.id in exclude_sources or item.id in exclude_items:
                continue
            concepts = self._item_concepts(item.id)
            by_concept = any(topic_of.get(c) in wanted for c in concepts)
            if not (wanted & set(source.topics) or by_concept):
                continue
            published = item.published_at.timestamp() if item.published_at else 0.0
            row = CandidateArticle(item.id, source.id)
            found.append((item.published_at is None, -published, -item.id, row))
        return [f[3] for f in sorted(found, key=lambda f: f[:3])][:limit]

    def _item_concepts(self, item_id: int) -> frozenset[str]:
        corrected = self._store.tags.item_concept_overrides.get(item_id)
        if corrected is not None:
            return corrected
        tags, _ = self._store.tags.for_item(item_id)
        return tags.concepts if tags else frozenset()

    def topic_moments(
        self,
        topics: list[Topic],
        limit: int,
        *,
        exclude_sources: set[int],
        exclude_items: set[int],
        exclude_moments: frozenset[int] = frozenset(),
    ) -> list[CandidateMoment]:
        # Mirrors PostgresRankingInputs.topic_moments.
        store = self._store
        graph = store.concepts.state()
        topic_of = {c.slug: c.topic for c in graph.concepts} if graph else {}
        wanted = set(topics)
        shown = shown_items(store)
        found: list[tuple[bool, float, int, int, CandidateMoment]] = []
        for moment in store.moments.rows:
            item = store.items.rows[moment.item_id]
            source = store.sources.rows[item.source_id]
            if item.id not in shown or not source.active:
                continue
            if source.id in exclude_sources or item.id in exclude_items:
                continue
            if moment.id in exclude_moments:
                continue
            concepts = self._item_concepts(item.id)
            by_concept = any(topic_of.get(c) in wanted for c in concepts)
            if not (wanted & set(source.topics) or by_concept):
                continue
            published = item.published_at.timestamp() if item.published_at else 0.0
            row = CandidateMoment(moment.id, item.id, source.id)
            undated = item.published_at is None
            found.append((undated, -published, -item.id, moment.row.ordinal, row))
        return [f[4] for f in sorted(found, key=lambda f: f[:4])][:limit]


class InMemoryStore:
    def __init__(self) -> None:
        self.sources = InMemorySources()
        self.items = InMemoryItems(self.sources)
        self.moments = InMemoryMoments(self.items, self.sources)
        self.invites = InMemoryInvites()
        self.users = InMemoryUsers()
        self.feed = InMemoryFeed(self.users, self.moments)
        self.notes = InMemoryNotes(self.items, self.sources)
        self.moments.on_delete = self.feed.drop_missing
        self.grants = InMemoryGrants(self.users)
        self.validators = InMemoryValidators()
        self.concepts = InMemoryConcepts()
        self.tags = InMemoryItemTags(self.items, self.moments)
        self.embeddings = InMemoryEmbeddings(
            self.items, self.sources, self.moments, self.tags
        )
        self.embeddings.store = self
        self.ranking = InMemoryRankingInputs(self)
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

    def fetch_if_changed(
        self, url: str, kind: FetchKind, known: Validators | None
    ) -> Fetched | None:
        page = self.fetch(url, kind)
        # A server answers 304 when the validators the client sends still match.
        if known is not None and known == page.validators:
            return None
        return page
