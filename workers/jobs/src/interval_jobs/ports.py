"""Ports (ADR-0012): the only way business logic reaches storage, the web or parsing.

Adapters in `interval_jobs.adapters` implement these; `compose.py` wires them. Logic
never imports a driver or SDK, so a service is swapped by replacing one adapter.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal
from threading import Event
from typing import Literal, Protocol, TypedDict

from pydantic import BaseModel, ConfigDict

from interval_db.generated import (
    AiFeature,
    AiProvider,
    BetaGroup,
    BreakLength,
    Capability,
    ConceptEdgeType,
    Difficulty,
    LearningGoal,
    MomentLinkType,
    RightsProfile,
    Topic,
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
    # Whether the page allows Interval's in-app reader to frame it (ADR-0018); None
    # when unknown.
    frameable: bool | None = None


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

    def ids(self) -> list[int]:
        """Every stored item, for the weekly link check (P1-W6-S03)."""
        ...

    def link_health(self, item_id: int) -> tuple[str, datetime | None] | None:
        """The item's URL and when it was found broken (None: fine); None if gone."""
        ...

    def set_link_broken(self, item_id: int, at: datetime | None) -> None:
        """Marks the link broken at `at`, keeping an earlier mark; None clears it."""
        ...

    def set_frameable(self, item_id: int, frameable: bool) -> None:
        """Whether the item's page lets Interval's reader frame it (ADR-0018)."""
        ...

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

    def boundary_override(self, item_id: int) -> list[str] | None:
        """Headings an admin chose for moments to start at (ING-6, P1-W3-S05)."""
        ...

    def for_fetch(self, item_id: int) -> FetchInput | None: ...

    def has_body(self, item_id: int) -> bool:
        """Whether the item's stored body (full text or excerpt) exists."""
        ...


@dataclass(frozen=True)
class MomentLink:
    """A moment's deep link, for checking where it lands (P1-W6-S02)."""

    moment_id: int
    item_id: int
    source_id: int
    source_name: str
    title: str
    link: str
    link_type: MomentLinkType


class Moments(Protocol):
    def exist(self, item_id: int) -> bool: ...

    def links(self, source_id: int | None) -> list[MomentLink]:
        """Every moment's link, or one source's, by source then item and ordinal."""
        ...

    def replace(self, item_id: int, rows: list[MomentRow]) -> None:
        """Upsert by ordinal (ids stay stable) and remove ordinals no longer present."""
        ...


@dataclass(frozen=True)
class RankedEntry:
    """One feed entry, in rank order (the list's order is the rank): a moment, or with
    no moment the whole article (§3.2, P1-W4-S05b)."""

    item_id: int
    moment_id: int | None
    top_signal: str  # the rule that counted most: what the entry's note says
    note_id: int | None  # its why-this-matters note (P1-W4-S06)
    # The exploration arm that placed it (REC-4); None for a main pick. Opens and
    # finishes of it count toward that arm (P1-W5-S03).
    arm: "Arm | None" = None
    breakdown: "Breakdown | None" = None  # a starter feed's entries keep none


class Feed(Protocol):
    """Precomputed feeds (CACHE-1, Q-P1-17): the worker writes them, the web reads."""

    def hold_user(self, user_id: str) -> None:
        """Until the unit of work ends, no other recompute of this user runs: call it
        before ranking, so the later of two recomputes ranks on the newer inputs."""
        ...

    def replace_user(
        self,
        user_id: str,
        by_chip: Mapping[BreakLength, list[RankedEntry]],
        computed_at: datetime,
    ) -> None:
        """Replaces the user's whole feed, one list per time chip (Q-P1-16), and records
        when, in one transaction: a failure leaves the previous feed exactly as it was
        (LOAD-5). A user or moment deleted since ranking is skipped, not an error."""
        ...

    def replace_starter(
        self,
        topic: str,
        level: Difficulty,
        chip: BreakLength,
        ranked: list[RankedEntry],
    ) -> None:
        """Replaces one starter feed (ADR-0008: a new guest's feed meanwhile)."""
        ...

    def active_users(self, since: datetime) -> list[str]:
        """Users whose session was used at or after `since` (owner: 7 days)."""
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


type ConceptEdge = tuple[str, str, ConceptEdgeType]  # (from slug, to slug, type)


@dataclass(frozen=True)
class ConceptSeed:
    slug: str
    name: str
    topic: str
    description: str | None
    retired: bool
    merged_into: str | None  # slug
    # Abbreviations and other spellings, matched in text for the tagging shortlist.
    aliases: tuple[str, ...] = ()


@dataclass(frozen=True)
class ConceptGraph:
    """A whole graph: every concept (retired ones too) and every edge, by slug."""

    version: int
    concepts: list[ConceptSeed]
    edges: set[ConceptEdge]


class ConceptCycleError(ValueError):
    """A "prerequisite of" cycle (Q-P1-04): refused by the parser and the store."""


@dataclass(frozen=True)
class ItemDecisions:
    """A decision model's raw answers for one item (tagging v3, 2026-10-27)."""

    # moment id -> (difficulty score, concept slug -> probability)
    moments: dict[int, tuple[float, dict[str, float]]]
    item: dict[str, float]  # the title/summary pass: concept slug -> probability
    item_difficulty: float | None = None  # the title/summary pass's score


@dataclass(frozen=True)
class QuestionDraft:
    """One drafted multiple-choice question (Q-1, Q-P2-08): `correct` indexes
    `options`; `citation` quotes the moment's text (Q-P2-12)."""

    stem: str
    options: tuple[str, ...]
    correct: int
    citation: str


@dataclass(frozen=True)
class QuestionTarget:
    """A moment questions may be drafted for (Q-P2-09): not a duplicate's, its source
    allows full text and moments (ING-2), and it has live concepts (an admin's
    correction replacing the model's tags) as (slug, name)."""

    moment_id: int
    item_id: int
    concepts: tuple[tuple[str, str], ...]


@dataclass(frozen=True)
class ValidatedQuestion:
    question_id: int
    draft: QuestionDraft
    validator_answer: int
    status: str


@dataclass(frozen=True)
class QuestionSummary:
    counts: dict[str, int]
    sample: list[ValidatedQuestion]


class Questions(Protocol):
    """The question bank (Q-1, P2-W8-S01)."""

    def target(self, moment_id: int) -> QuestionTarget | None: ...

    def targets(self, item_id: int | None) -> list[int]:
        """The item's moments that are targets; every target when item_id is None."""
        ...

    def drafted_hash(self, moment_id: int) -> str | None:
        """The content hash the moment's questions were drafted from; None if none."""
        ...

    def save(
        self,
        moment_id: int,
        drafts: Sequence[QuestionDraft],
        concepts: Sequence[str],
        model: str,
        prompt_version: int,
        content_hash: str,
    ) -> list[int]:
        """These, pending, each tagged with the concepts (slugs), in place of the
        moment's current questions, which are retired, not deleted; clears the
        moment's retry state. Their ids, in order."""
        ...

    def retry_state(self, moment_id: int) -> tuple[int, datetime] | None:
        """The attempt the moment's newest retry carries and when it is due."""
        ...

    def record_retry(
        self, moment_id: int, attempt: int, retry_at: datetime
    ) -> None: ...

    def clear_retry(self, moment_id: int) -> None:
        """Drafting gave up (a reply that kept breaking the rules)."""
        ...

    # P2-W8-S02 (Q-1): the blind validator.
    def pending(self, question_id: int) -> tuple[int, QuestionDraft] | None:
        """A question still waiting for its verdict, with its moment; None once
        validated, retired, or gone."""
        ...

    def pending_ids(self, moment_id: int) -> list[int]:
        """The moment's questions still waiting for a verdict (re-queued by a
        backfill, so none waits forever)."""
        ...

    def record_verdict(self, question_id: int, model: str, answer: int) -> bool:
        """Live when the validator's answer is the key, rejected when not, keeping
        the answer; false (nothing changed) unless the question was pending."""
        ...

    def queue_spot_checks(self, since: datetime, share: float) -> tuple[int, int]:
        """Q-2: queue for review a random `share` (rounded up) of the live questions
        created since `since`, less those already sampled from that window, plus every
        flagged question not yet queued; (sampled, flagged) counts."""
        ...

    def summary(self, sample: int) -> QuestionSummary:
        """Counts by status (retired left out) and a random sample of validated
        questions, for the owner to read (`question-report`)."""
        ...


class Decisions(Protocol):
    """A decision model's raw answers, kept so cut-offs can be retuned without asking
    again; each with the hash of what was asked about."""

    def moment_hashes(self, item_id: int, model: str) -> dict[int, str]: ...

    def save_moment(
        self,
        moment_id: int,
        model: str,
        content_hash: str,
        difficulty: float,
        probabilities: dict[str, float],
    ) -> None:
        """Replaces the moment's earlier answers from this model."""
        ...

    def item_hash(self, item_id: int, model: str) -> str | None: ...

    def save_item(
        self,
        item_id: int,
        model: str,
        content_hash: str,
        difficulty: float,
        probabilities: dict[str, float],
    ) -> None: ...

    def read(self, item_id: int, model: str) -> ItemDecisions: ...


class Concepts(Protocol):
    def state(self) -> ConceptGraph | None:
        """The loaded graph at its latest version; None before the first load."""
        ...

    def apply(self, graph: ConceptGraph) -> None:
        """Makes the tables match the graph and records its version. Concepts are
        upserted by slug, never deleted; edges are replaced."""
        ...

    def get(self, slug: str) -> ConceptSeed | None: ...

    def prerequisites(self, slug: str) -> set[str]:
        """Every concept learned before this one, transitively; retired ones left out
        (a path through one still counts)."""
        ...

    def vectors(self, model: str) -> dict[str, tuple[str, list[float]]]:
        """Each concept's vector from this model, with the hash of the text embedded
        (the tagging shortlist, 2026-10-27)."""
        ...

    def save_vector(
        self, slug: str, model: str, text_hash: str, vector: list[float]
    ) -> None: ...


@dataclass(frozen=True)
class TagMoment:
    id: int
    ordinal: int
    heading: str | None  # None: the intro, at the top of the page


@dataclass(frozen=True)
class TagInput:
    """What tagging reads about one item (P1-W3-S02)."""

    title: str
    summary: str | None
    full_text: str | None  # only under the source's current full-text rights (ING-2)
    excerpt: str | None  # only under the excerpt profile ("for tagging", Q-P1-01)
    moments: list[TagMoment]
    tagged_version: int | None  # prompt version it was last tagged with
    duplicate: bool  # tag the primary only (AI-4: once per item)


@dataclass(frozen=True)
class Tags:
    difficulty: Difficulty  # Q-P1-10
    concepts: frozenset[str]  # slugs


@dataclass(frozen=True)
class TagResult:
    item: Tags
    moments: dict[int, Tags]  # by moment id


class ItemTags(Protocol):
    """AI output, stored apart from source text with its model and prompt (AI-3)."""

    def input(self, item_id: int) -> TagInput | None: ...

    def version(self, item_id: int) -> int | None:
        """The prompt version the item was tagged with; None if never."""
        ...

    def needs_tagging(self, item_id: int, prompt_version: int) -> bool:
        """Not yet tagged at this prompt version, and not a duplicate (AI-4)."""
        ...

    def clear(self, item_id: int) -> None:
        """Drops the item's tags: its moments changed, so they are redone."""
        ...

    def find(self, canonical_url: str) -> int | None:
        """The primary item at this canonical URL (eval labels name items by URL)."""
        ...

    def save(
        self, item_id: int, result: TagResult, model: str, prompt_version: int
    ) -> None:
        """Replaces the item's and its moments' tags. Moment ids that aren't the
        item's are refused."""
        ...

    def for_item(self, item_id: int) -> tuple[Tags | None, dict[int, Tags]]:
        """The item's tags and its moments' tags by ordinal; retired concepts too."""
        ...


@dataclass(frozen=True)
class SimilarMoment:
    moment_id: int
    item_id: int
    source_id: int
    score: float  # cosine similarity, 1 is identical


class MomentEmbeddings(Protocol):
    """One vector per moment (DB-3); moments exist only under full-text rights."""

    def missing(self, item_id: int, model: str) -> bool:
        """The item has moments, isn't a duplicate, and hasn't been embedded in full
        by this model (AI-4: once per item and model)."""
        ...

    def done(self, item_id: int, model: str) -> set[int]:
        """Moments that already have a vector from this model."""
        ...

    def save(
        self,
        item_id: int,
        vectors: dict[int, list[float]],
        model: str,
        *,
        complete: bool,
    ) -> None:
        """Upserts by moment id (another item's moment ids are refused). `complete`
        records that every moment with text has been embedded by this model."""
        ...

    def clear(self, item_id: int) -> None: ...

    def vectors_of_item(self, item_id: int, model: str) -> dict[int, list[float]]:
        """The item's moment vectors from this model by moment id (ranking's
        anchors; tagging's shortlist)."""
        ...

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
        """Nearest moments first, in one query filtered by rights, source and
        difficulty (DB-3). A difficulty filter leaves out untagged moments; `model`
        keeps to one model's vectors, which are the only ones comparable. Only the copy
        of a duplicate group the feed shows, from active sources, is returned."""
        ...


# The migration's enum order (learning_goal), which both stores return goals in. Written
# out because codegen sorts the generated Literal alphabetically, losing that order.
LEARNING_GOALS: tuple[LearningGoal, ...] = (
    "system-design-interviews",
    "stack-i-use",
    "finish-that-book",
    "stay-sharp",
)


@dataclass(frozen=True)
class UserPreferences:
    """The explicit layer (PER-1), written by the web app's onboarding (P1-W4-S01)."""

    topics: list[Topic]
    level: Difficulty
    break_length: BreakLength
    # ADR-0015, in LEARNING_GOALS order; none for a starter feed.
    goals: list[LearningGoal] = field(default_factory=list["LearningGoal"])


@dataclass(frozen=True)
class CandidateMoment:
    moment_id: int
    item_id: int
    source_id: int


# (item id, moment id): a moment, or with no moment the whole article.
type EntryKey = tuple[int, int | None]


@dataclass(frozen=True)
class EntryFacts:
    """What scoring needs about one candidate: a moment or a whole article (P1-W4-S03,
    P1-W4-S05b)."""

    moment_id: int | None
    item_id: int
    source_id: int
    minutes: int | None  # None: an article with no body text to count (Q-P1-39)
    difficulty: Difficulty | None  # the admin's correction, else the model's, else none
    published_at: datetime | None
    quality: int | None  # the source's 1-5 score (ING-6)
    concepts: frozenset[str]  # the item's: the admin's correction, else the model's
    topics: frozenset[str]  # its source's seed topics and its concepts' topics
    source_name: str  # for the why-this-matters note (P1-W4-S06)

    @property
    def key(self) -> EntryKey:
        return (self.item_id, self.moment_id)


@dataclass(frozen=True)
class Arm:
    """An exploration arm (REC-4, P1-W4-S09): a topic the user didn't choose, or a
    source new to them (its id)."""

    kind: Literal["topic", "source"]
    key: str


@dataclass(frozen=True)
class Breakdown:
    """How an entry's score was made, by rule (REC-2): each signal's value, the weight
    it was scored with, their product, and the penalty taken off. Kept for the owner's
    ranking inspection (P1-W6-S01); the weights are kept because ranking_config may
    change before the next recompute."""

    values: dict[str, float]
    weights: dict[str, float]
    weighted: dict[str, float]
    penalty: float


@dataclass(frozen=True)
class ArmOutcome:
    """Across all users (owner, 2026-10-26); Week 5's reading slices count them."""

    shown: int
    finished: int


@dataclass(frozen=True)
class Finished:
    """What a user finished (P1-W5-S02): not offered again (P1-W5-S03)."""

    moments: frozenset[int]
    items: frozenset[int]


@dataclass(frozen=True)
class CandidateArticle:
    item_id: int
    source_id: int


class RankingInputs(Protocol):
    """What ranking reads (REC-1, Q-P1-15): a user's choices and feedback, which the
    web app writes, and the moments that match them."""

    def preferences(self, user_id: str) -> UserPreferences | None: ...

    def goal_concepts(
        self, goals: list[LearningGoal]
    ) -> dict[LearningGoal, frozenset[str]]:
        """The curated concept slugs of each goal that has any (ADR-0015)."""
        ...

    def hidden_sources(self, user_id: str) -> set[int]: ...

    def not_interested(self, user_id: str) -> set[int]:
        """Item ids the user said Not interested to: never shown again."""
        ...

    def anchor_items(self, user_id: str, limit: int) -> list[int]:
        """Items to find similar moments from (Q-P1-13): those the user said More like
        this to, then those they saved (P1-W4-S07), each newest first, once."""
        ...

    def less_liked(self, user_id: str) -> set[int]:
        """Items the user said Less like this to (a score penalty, P1-W4-S03)."""
        ...

    def avoided_concepts(self, user_id: str) -> frozenset[str]:
        """Concepts of the items the user said Not interested to (Q-P1-15)."""
        ...

    def config(self) -> dict[str, float]:
        """`ranking_config`: every weight in one place (Q-P1-13)."""
        ...

    def moment_facts(self, moment_ids: list[int]) -> dict[int, EntryFacts]:
        """By moment id; a moment deleted meanwhile (a re-segment) is left out."""
        ...

    def topic_moments(
        self,
        topics: list[Topic],
        limit: int,
        *,
        exclude_sources: set[int],
        exclude_items: set[int],
        exclude_moments: frozenset[int] = frozenset(),
    ) -> list[CandidateMoment]:
        """Moments whose item's concepts (an admin's correction first, else the model's
        tags) or source's seed topics match, newest first. Only the copy of a duplicate
        group the feed shows, from active sources."""
        ...

    def finished(self, user_id: str) -> Finished: ...

    def arm_outcomes(self) -> dict[Arm, ArmOutcome]:
        """Every arm with recorded outcomes; an arm not listed is at its prior."""
        ...

    def article_facts(self, item_ids: list[int]) -> dict[int, EntryFacts]:
        """Whole articles by item id: minutes from the stored sections (230 words a
        minute), None with no body text; the item's level, not a moment's."""
        ...

    def topic_articles(
        self,
        topics: list[Topic],
        limit: int,
        *,
        exclude_sources: set[int],
        exclude_items: set[int],
    ) -> list[CandidateArticle]:
        """Items matching as topic_moments does, newest first, whatever their rights
        profile (a whole article shows only its title and link). Per duplicate group,
        the copy the feed shows: the earliest with moments, else the earliest."""
        ...


class FetchValidators(Protocol):
    def get(self, url: str) -> Validators | None:
        """None when none are stored or they are older than VALIDATORS_MAX_AGE."""
        ...

    def put(self, url: str, validators: Validators | None) -> None:
        """None forgets the URL's validators (the server stopped sending them)."""
        ...


@dataclass(frozen=True)
class NoteKey:
    """What a why-this-matters note is cached by (Q-P1-18): the item it cites, the
    signal, the level, and the topic, chip or goal its words name ('' for none)."""

    item_id: int
    signal: str
    level: Difficulty
    variant: str


@dataclass(frozen=True)
class NoteRef:
    note_id: int
    # No polish tried yet: the notes model may still reword it, once (AI-4).
    needs_polish: bool


@dataclass(frozen=True)
class NoteInput:
    """All the notes model may see (AI-1): never the article's text."""

    note_id: int
    title: str
    source_name: str
    text: str


class Notes(Protocol):
    def ensure_all(self, texts: Mapping[NoteKey, str]) -> dict[NoteKey, NoteRef]:
        """The note for each key, written with its text the first time only. Keys are
        written in one order, so recomputes sharing notes wait rather than deadlock;
        one waiting on another's uncommitted note gets that note once it commits."""
        ...

    def input(self, note_id: int) -> NoteInput | None:
        """What polishing needs; None when the note is gone or its polish was tried."""
        ...

    def polish(self, note_id: int, text: str | None, model: str) -> None:
        """Records the one polish: the model's wording, or None when its reply was
        refused (the template stays). A second polish of the note changes nothing."""
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
    def notes(self) -> Notes: ...

    @property
    def invites(self) -> Invites: ...

    @property
    def users(self) -> Users: ...

    @property
    def grants(self) -> Grants: ...

    @property
    def validators(self) -> FetchValidators: ...

    @property
    def concepts(self) -> Concepts: ...

    @property
    def tags(self) -> ItemTags: ...

    @property
    def embeddings(self) -> MomentEmbeddings: ...

    @property
    def ranking(self) -> RankingInputs: ...

    @property
    def decisions(self) -> Decisions: ...

    @property
    def questions(self) -> Questions: ...


class Fetcher(Protocol):
    def fetch(self, url: str, kind: FetchKind) -> Fetched: ...

    def check(self, url: str) -> bool:
        """The page's status only: on success, whether it can be framed (ADR-0018);
        raises FetchError as fetch does. It never reads the body, so any rights profile
        allows it (P1-W6-S03)."""
        ...

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


# Documents are stored and searched; queries search them (Voyage's input_type).
type EmbeddingPurpose = Literal["document", "query"]


class ModelError(Exception):
    """A model call failed or answered with something unusable (ADR-0007)."""


class LlmClient(Protocol):
    """Large-model calls (ADR-0007: OpenRouter). Only ai/gateway.py uses this."""

    @property
    def provider(self) -> AiProvider: ...

    def complete(self, model: str, messages: list[Message]) -> Completion: ...


# Decision models (OpenRouter's Decisions API, e.g. TypeSafe's Jev): typed questions
# about a state, typed answers with probabilities instead of generated text.
@dataclass(frozen=True)
class ChoiceAnswer:
    choice: str
    probabilities: dict[str, float]  # every option's, when the model gives them


@dataclass(frozen=True)
class ScoreAnswer:
    score: float  # a position on the question's ordered rubric, from 0


@dataclass(frozen=True)
class NoulAnswer:
    probability: float  # of "yes", from 0 to 1


type DecisionAnswer = ChoiceAnswer | ScoreAnswer | NoulAnswer
type DecisionState = dict[str, object]


@dataclass(frozen=True)
class Decision:
    answers: dict[str, DecisionAnswer]
    input_tokens: int
    output_tokens: int
    cost_usd: Decimal  # as the provider reports it


class DecisionClient(Protocol):
    """Decision-model calls (OpenRouter's Decisions API). Only ai/gateway.py uses
    this."""

    @property
    def provider(self) -> AiProvider: ...

    def decide(
        self, model: str, state: DecisionState, questions: dict[str, object]
    ) -> Decision: ...


class EmbeddingClient(Protocol):
    """Embeddings (ADR-0007: Voyage AI). Only ai/gateway.py uses this."""

    @property
    def provider(self) -> AiProvider: ...

    def embed(
        self, model: str, texts: list[str], purpose: EmbeddingPurpose
    ) -> Embeddings: ...


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
