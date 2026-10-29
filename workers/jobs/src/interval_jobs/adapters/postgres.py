"""Postgres adapter (ADR-0012): the repositories behind `Store`, over one connection.

One `PostgresStore` is one unit of work; `unit_of_work` commits it on success and rolls
it back on error. The database's own triggers still guard ING-2 behind these queries.
"""

from collections.abc import Collection, Generator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import asdict
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Literal, cast

import psycopg
from psycopg.rows import class_row
from psycopg.types.json import Jsonb

from interval_db.generated import (
    AiProvider,
    BetaGroup,
    BreakLength,
    Capability,
    Difficulty,
    LearningGoal,
    RightsProfile,
    Topic,
)
from interval_jobs.concepts.graph import TOPICS
from interval_jobs.irt import Answer
from interval_jobs.normalize import MAX_SIMHASH_DISTANCE
from interval_jobs.ports import (
    VALIDATORS_MAX_AGE,
    Arm,
    ArmOutcome,
    BatchItemResult,
    BatchKind,
    BookChapterRow,
    BookJob,
    BookPageText,
    BookQuestion,
    CandidateArticle,
    CandidateMoment,
    ChapterForCheckpoint,
    ConceptCoverage,
    ConceptCycleError,
    ConceptEdge,
    ConceptGraph,
    ConceptSeed,
    DuplicateInviteCode,
    EntryFacts,
    FeedEntry,
    FetchInput,
    Finished,
    GitHubSyncInput,
    GrantResult,
    ItemDecisions,
    MomentLink,
    MomentRow,
    NoteInput,
    NoteKey,
    NoteRef,
    PathDraft,
    QuestionBatchEntry,
    QuestionDraft,
    QuestionSummary,
    QuestionTarget,
    RankedEntry,
    RepoRead,
    RevokeResult,
    RightsViolation,
    Section,
    SectionRow,
    SegmentationInput,
    SessionCandidate,
    SimilarMoment,
    SourceRecord,
    SourceSettings,
    SyncResult,
    TagInput,
    TagMoment,
    TagResult,
    Tags,
    TechnologiesSynced,
    TechnologySuggestion,
    Unclaimed,
    Usage,
    UserPreferences,
    ValidatedQuestion,
    Validators,
)
from interval_jobs.questions import PROMPT_VERSION as QUESTIONS_PROMPT_VERSION
from interval_jobs.technologies import TechnologySeed


@contextmanager
def _rights_guard(conn: psycopg.Connection) -> Generator[None]:
    """The ING-2 triggers raise; callers see the port's RightsViolation instead.

    Each guarded write runs in a savepoint, so a refused write leaves the unit of work
    usable rather than aborting the whole transaction.
    """
    try:
        with conn.transaction():
            yield
    except psycopg.errors.RaiseException as error:
        raise RightsViolation(str(error).splitlines()[0]) from error


# Serialises rewrites of one feed (a user's, or one starter): two delete+insert runs at
# once would collide on the primary key (LOAD-5: jobs may run twice and side by side).
FEED_LOCK_KEY = 0x1E_ED_F0_0D
# Serialises duplicate linking: two stages regrouping overlapping items at once could
# each pick a different primary.
DUPLICATES_LOCK_KEY = 0xD0_B1_E5


class PostgresSources:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def get(self, source_id: int) -> SourceRecord | None:
        with self._conn.cursor(row_factory=class_row(SourceRecord)) as cur:
            return cur.execute(
                "select id, feed_url, rights_profile, active, moments_enabled, "
                "make_interval(secs => poll_interval_seconds) as poll_interval, "
                "polled_at "
                "from source where id = %s",
                (source_id,),
            ).fetchone()

    def active_ids(self) -> list[int]:
        rows = self._conn.execute(
            "select id from source where active order by id"
        ).fetchall()
        return [int(r[0]) for r in rows]

    def claim_due(self, now: datetime) -> list[int]:
        rows = self._conn.execute(
            """
            update source
            set next_poll_at = %(now)s + make_interval(secs => poll_interval_seconds)
            where id in (
              select id from source
              where active and next_poll_at <= %(now)s
              for update skip locked
            )
            returning id
            """,
            {"now": now},
        ).fetchall()
        return sorted(int(r[0]) for r in rows)

    def record_poll(
        self, source_id: int, interval: timedelta, polled_at: datetime
    ) -> None:
        self._conn.execute(
            "update source set poll_interval_seconds = %s, polled_at = %s, "
            "next_poll_at = %s where id = %s",
            (
                round(interval.total_seconds()),
                polled_at,
                polled_at + interval,
                source_id,
            ),
        )

    def upsert(
        self,
        *,
        name: str,
        feed_url: str,
        rights_profile: RightsProfile,
        homepage: str | None,
    ) -> int:
        row = self._conn.execute(
            """
            insert into source (name, feed_url, rights_profile, homepage)
            values (%s, %s, %s, %s)
            on conflict (name) do update
              set feed_url = excluded.feed_url,
                  rights_profile = excluded.rights_profile,
                  homepage = excluded.homepage,
                  active = true
            returning id
            """,
            (name, feed_url, rights_profile, homepage),
        ).fetchone()
        if row is None:
            raise RuntimeError("upsert returned no row")
        source_id: int = row[0]
        return source_id

    def sync(self, seeds: list[SourceSettings]) -> SyncResult:
        added = updated = unchanged = 0
        for seed in seeds:
            # By name, or else by feed: a rename, or a row ingest-one made.
            row = self._conn.execute(
                f"select id, name, {_SETTINGS_READ}, active from source "
                "where name = %s or feed_url = %s "
                "order by (name = %s) desc limit 1",
                (seed.name, seed.feed_url, seed.name),
            ).fetchone()
            values = _settings_values(seed)
            if row is None:
                self._conn.execute(
                    f"insert into source (name, {_SETTINGS_WRITE}, moments_enabled) "
                    "values (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (seed.name, *values, seed.moments_enabled),
                )
                added += 1
                continue
            current = (row[1], *row[2:8], list(row[8]))
            if row[9] and current == (seed.name, *values):
                unchanged += 1
                continue
            # One update, so the purge triggers see profile and switch together. An
            # admin's moments switch (P1-W3-S06) outlives the reload.
            self._conn.execute(
                f"update source set (name, {_SETTINGS_WRITE}, active, "
                "moments_enabled) = (%s, %s, %s, %s, %s, %s, %s, %s, true, "
                "%s and not moments_switched_off) where id = %s",
                (seed.name, *values, seed.moments_enabled, row[0]),
            )
            updated += 1
        deactivated = self._conn.execute(
            "update source set active = false where active and name <> all(%s)",
            ([seed.name for seed in seeds],),
        ).rowcount
        return SyncResult(added, updated, unchanged, deactivated)


# The seed file's own settings; moments_enabled itself is moments_seeded unless an
# admin switched moments off (P1-W3-S06).
_SETTINGS_WRITE = (
    "feed_url, rights_profile, homepage, moments_seeded, paywalled, "
    "quality_score, topics"
)
# The same columns read back for comparison: the enum as text.
_SETTINGS_READ = _SETTINGS_WRITE.replace("rights_profile", "rights_profile::text")


def _settings_values(seed: SourceSettings) -> tuple[object, ...]:
    return (
        seed.feed_url,
        seed.rights_profile,
        seed.homepage,
        seed.moments_enabled,
        seed.paywalled,
        seed.quality_score,
        list(seed.topics),
    )


class PostgresItems:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def ids(self) -> list[int]:
        rows = self._conn.execute("select id from content_item order by id").fetchall()
        return [int(row[0]) for row in rows]

    def link_health(self, item_id: int) -> tuple[str, datetime | None] | None:
        row = self._conn.execute(
            "select canonical_url, link_broken_at from content_item where id = %s",
            (item_id,),
        ).fetchone()
        return None if row is None else (str(row[0]), row[1])

    def set_frameable(self, item_id: int, frameable: bool) -> None:
        self._conn.execute(
            "update content_item set frameable = %s where id = %s",
            (frameable, item_id),
        )

    def set_link_broken(self, item_id: int, at: datetime | None) -> None:
        self._conn.execute(
            "update content_item set link_broken_at = "
            "case when %(at)s::timestamptz is null then null "
            "else coalesce(link_broken_at, %(at)s) end where id = %(item)s",
            {"at": at, "item": item_id},
        )

    def upsert_from_feed(
        self, source_id: int, entry: FeedEntry, keep_excerpt: bool
    ) -> int:
        row = self._conn.execute(
            """
            insert into content_item
              (source_id, guid, canonical_url, title, author,
               published_at, feed_summary)
            values (%s, %s, %s, %s, %s, %s, %s)
            on conflict (source_id, guid) do update
              set title = excluded.title,
                  author = excluded.author,
                  published_at = excluded.published_at,
                  feed_summary = excluded.feed_summary,
                  excerpt = case when %s then content_item.excerpt end,
                  fetched_at = now()
            returning id
            """,
            (
                source_id,
                entry.guid,
                entry.link,
                entry.title,
                entry.author,
                entry.published_at,
                entry.summary,
                keep_excerpt,
            ),
        ).fetchone()
        if row is None:
            raise RuntimeError("upsert returned no row")
        item_id: int = row[0]
        return item_id

    def known_guids(self, source_id: int, guids: list[str]) -> set[str]:
        rows = self._conn.execute(
            "select guid from content_item where source_id = %s and guid = any(%s)",
            (source_id, guids),
        ).fetchall()
        return {str(r[0]) for r in rows}

    def set_canonical(self, item_id: int, url: str) -> None:
        self._conn.execute(
            "update content_item set canonical_url = %s where id = %s", (url, item_id)
        )

    def set_simhash(self, item_id: int, simhash: int) -> None:
        with _rights_guard(self._conn):
            self._conn.execute(
                "update content_item set simhash = %s where id = %s", (simhash, item_id)
            )

    def hold_duplicate_lock(self) -> None:
        self._conn.execute("select pg_advisory_xact_lock(%s)", (DUPLICATES_LOCK_KEY,))

    def link_duplicates(self, item_id: int) -> int:
        self.hold_duplicate_lock()
        row = self._conn.execute(
            """
            with me as (
              select ci.id, ci.canonical_url, ci.simhash, lower(ci.author) as author,
                     item_title_key(ci.title) as title_key,
                     (ci.published_at at time zone 'UTC')::date as day,
                     s.rights_profile in ('full_text_internal', 'full_text_display')
                       as full_text
              from content_item ci join source s on s.id = ci.source_id
              where ci.id = %(id)s
            ),
            -- One indexed lookup per rule rather than an OR over every item.
            matches as (
              select id from me
              union
              select ci.id from content_item ci, me
              where ci.canonical_url = me.canonical_url
              union
              -- The rights trigger and purge keep simhash on full-text items only.
              select ci.id from content_item ci, me
              where me.full_text and ci.simhash is not null
                and bit_count((ci.simhash # me.simhash)::bit(64)) <= %(distance)s
              union
              select ci.id from content_item ci
              join source s on s.id = ci.source_id, me
              where item_title_key(ci.title) = me.title_key
                and (ci.published_at at time zone 'UTC')::date = me.day
                and lower(ci.author) = me.author
                and not (
                  me.full_text
                  and s.rights_profile in ('full_text_internal', 'full_text_display')
                )
            ),
            roots as (
              select id from matches
              union
              select duplicate_of from content_item
              where id in (select id from matches) and duplicate_of is not null
            ),
            grp as (
              select id from roots
              union
              select id from content_item where duplicate_of in (select id from roots)
            ),
            chosen as (
              select id from content_item where id in (select id from grp)
              order by published_at nulls last, id limit 1
            ),
            relinked as (
              update content_item ci
              set duplicate_of = nullif(chosen.id, ci.id)
              from chosen
              where ci.id in (select id from grp)
                and ci.duplicate_of is distinct from nullif(chosen.id, ci.id)
            )
            select id from chosen
            """,
            {"id": item_id, "distance": MAX_SIMHASH_DISTANCE},
        ).fetchone()
        if row is None:
            raise RuntimeError(f"content item {item_id} not found")
        primary: int = row[0]
        return primary

    def set_excerpt(self, item_id: int, excerpt: str) -> None:
        with _rights_guard(self._conn):
            self._conn.execute(
                "update content_item set excerpt = %s where id = %s", (excerpt, item_id)
            )

    def store_full_text(self, item_id: int, text: str) -> None:
        with _rights_guard(self._conn):
            self._conn.execute(
                """
                insert into content_item_private_text (content_item_id, text)
                values (%s, %s)
                on conflict (content_item_id) do update
                  set text = excluded.text, extracted_at = now()
                """,
                (item_id, text),
            )

    def drop_full_text(self, item_id: int) -> None:
        self._conn.execute(
            "delete from content_item_private_text where content_item_id = %s",
            (item_id,),
        )

    def replace_sections(self, item_id: int, sections: list[Section]) -> None:
        with _rights_guard(self._conn):
            self._conn.execute(
                "delete from content_item_section where content_item_id = %s",
                (item_id,),
            )
            with self._conn.cursor() as cur:
                cur.executemany(
                    "insert into content_item_section "
                    "(content_item_id, ordinal, heading, level, anchor_id, word_count) "
                    "values (%s, %s, %s, %s, %s, %s)",
                    [
                        (item_id, i, s.heading, s.level, s.anchor_id, s.word_count)
                        for i, s in enumerate(sections)
                    ],
                )

    def for_segmentation(self, item_id: int) -> SegmentationInput | None:
        with self._conn.cursor(row_factory=class_row(SegmentationInput)) as cur:
            # Row lock: concurrent runs on one item take turns instead of colliding.
            return cur.execute(
                """
                select ci.title, ci.canonical_url, s.rights_profile, s.moments_enabled
                from content_item ci join source s on s.id = ci.source_id
                where ci.id = %s
                for update of ci
                """,
                (item_id,),
            ).fetchone()

    def sections(self, item_id: int) -> list[SectionRow]:
        with self._conn.cursor(row_factory=class_row(SectionRow)) as cur:
            return cur.execute(
                "select heading, anchor_id, word_count, level "
                "from content_item_section where content_item_id = %s order by ordinal",
                (item_id,),
            ).fetchall()

    def boundary_override(self, item_id: int) -> list[str] | None:
        row = self._conn.execute(
            "select headings from moment_boundary_override where content_item_id = %s",
            (item_id,),
        ).fetchone()
        return None if row is None else [str(h) for h in row[0]]

    def for_fetch(self, item_id: int) -> FetchInput | None:
        with self._conn.cursor(row_factory=class_row(FetchInput)) as cur:
            return cur.execute(
                """
                select ci.canonical_url, ci.title, s.rights_profile
                from content_item ci join source s on s.id = ci.source_id
                where ci.id = %s
                """,
                (item_id,),
            ).fetchone()

    def has_body(self, item_id: int) -> bool:
        row = self._conn.execute(
            """
            select 1 from content_item_private_text where content_item_id = %s
            union all
            select 1 from content_item where id = %s and excerpt is not null
            limit 1
            """,
            (item_id, item_id),
        ).fetchone()
        return row is not None


class PostgresMoments:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def exist(self, item_id: int) -> bool:
        row = self._conn.execute(
            "select 1 from moment where content_item_id = %s limit 1", (item_id,)
        ).fetchone()
        return row is not None

    def links(self, source_id: int | None) -> list[MomentLink]:
        with self._conn.cursor(row_factory=class_row(MomentLink)) as cur:
            return cur.execute(
                """
                select m.id as moment_id, ci.id as item_id, s.id as source_id,
                       s.name as source_name, m.title, m.link, m.link_type
                from moment m
                join content_item ci on ci.id = m.content_item_id
                join source s on s.id = ci.source_id
                where s.moments_enabled
                  and (%(source)s::bigint is null or s.id = %(source)s)
                order by s.id, ci.id, m.ordinal
                """,
                {"source": source_id},
            ).fetchall()

    def replace(self, item_id: int, rows: list[MomentRow]) -> None:
        with _rights_guard(self._conn):
            with self._conn.cursor() as cur:
                cur.executemany(
                    """
                    insert into moment
                      (content_item_id, ordinal, title, estimated_minutes,
                       link, link_type, oversized)
                    values (%s, %s, %s, %s, %s, %s, %s)
                    on conflict (content_item_id, ordinal) do update
                      set title = excluded.title,
                          estimated_minutes = excluded.estimated_minutes,
                          link = excluded.link,
                          link_type = excluded.link_type,
                          oversized = excluded.oversized
                    """,
                    [
                        (
                            item_id,
                            r.ordinal,
                            r.title,
                            r.estimated_minutes,
                            r.link,
                            r.link_type,
                            r.oversized,
                        )
                        for r in rows
                    ],
                )
            self._conn.execute(
                "delete from moment where content_item_id = %s and ordinal >= %s",
                (item_id, len(rows)),
            )


# The ranked entries as rows, numbered in order; an entry whose item or moment is gone
# is skipped.
_RANKED_ROWS = """
from unnest(%s::bigint[], %s::bigint[], %s::text[], %s::bigint[], %s::text[],
            %s::text[], %s::jsonb[]) with ordinality
  as r(item_id, moment_id, top_signal, note_id, explore_kind, explore_arm,
       score_parts, rank)
where exists (select 1 from content_item ci where ci.id = r.item_id)
  and (r.moment_id is null
       or exists (select 1 from moment m where m.id = r.moment_id))
"""


def _ranked_arrays(
    ranked: list[RankedEntry],
) -> tuple[
    list[int],
    list[int | None],
    list[str],
    list[int | None],
    list[str | None],
    list[str | None],
    list[Jsonb | None],
]:
    return (
        [r.item_id for r in ranked],
        [r.moment_id for r in ranked],
        [r.top_signal for r in ranked],
        [r.note_id for r in ranked],
        [r.arm.kind if r.arm else None for r in ranked],
        [r.arm.key if r.arm else None for r in ranked],
        [Jsonb(asdict(r.breakdown)) if r.breakdown else None for r in ranked],
    )


class PostgresNotes:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def ensure_all(self, texts: Mapping[NoteKey, str]) -> dict[NoteKey, NoteRef]:
        if not texts:
            return {}
        keys = sorted(texts, key=lambda k: (k.item_id, k.signal, k.level, k.variant))
        columns = (
            [k.item_id for k in keys],
            [k.signal for k in keys],
            [k.level for k in keys],
            [k.variant for k in keys],
        )
        # Sorted, so two writers lock shared keys in one order. On another's
        # uncommitted note this waits for its commit and then skips it.
        self._conn.execute(
            """
            insert into feed_note (content_item_id, signal, level, variant, text)
            select * from unnest(%s::bigint[], %s::text[], %s::difficulty[],
                                 %s::text[], %s::text[])
            on conflict (content_item_id, signal, level, variant) do nothing
            """,
            (*columns, [texts[k] for k in keys]),
        )
        # A second statement: its snapshot sees notes committed while the insert
        # waited.
        rows = self._conn.execute(
            """
            select n.id, n.content_item_id, n.signal, n.level, n.variant,
                   n.polished_at is null
            from feed_note n
            join unnest(%s::bigint[], %s::text[], %s::difficulty[], %s::text[])
              as k(item, signal, level, variant)
              on n.content_item_id = k.item and n.signal = k.signal
              and n.level = k.level and n.variant = k.variant
            """,
            columns,
        ).fetchall()
        return {
            NoteKey(int(r[1]), r[2], r[3], r[4]): NoteRef(int(r[0]), bool(r[5]))
            for r in rows
        }

    def input(self, note_id: int) -> NoteInput | None:
        row = self._conn.execute(
            "select n.id, ci.title, s.name, n.text from feed_note n "
            "join content_item ci on ci.id = n.content_item_id "
            "join source s on s.id = ci.source_id "
            "where n.id = %s and n.polished_at is null",
            (note_id,),
        ).fetchone()
        return NoteInput(int(row[0]), row[1], row[2], row[3]) if row else None

    def polish(self, note_id: int, text: str | None, model: str) -> None:
        # Once: a redelivered job finds it tried and changes nothing.
        self._conn.execute(
            "update feed_note set polished_at = now(), "
            "text = coalesce(%s, text), model = case when %s::text is null "
            "then null else %s end "
            "where id = %s and polished_at is null",
            (text, text, model, note_id),
        )


class PostgresFeed:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def hold_user(self, user_id: str) -> None:
        # Held to the end of the unit of work: the hourly pass and a feedback
        # recompute of one user take turns, ranking and writing.
        self._conn.execute(
            "select pg_advisory_xact_lock(%s, hashtext(%s))", (FEED_LOCK_KEY, user_id)
        )

    def replace_user(
        self,
        user_id: str,
        by_chip: Mapping[BreakLength, list[RankedEntry]],
        computed_at: datetime,
    ) -> None:
        # One savepoint: the old feed stays whole unless the new one lands (LOAD-5).
        with self._conn.transaction():
            self.hold_user(user_id)
            exists = self._conn.execute(
                "select 1 from app_user where id = %s", (user_id,)
            ).fetchone()
            if exists is None:
                return  # deleted since ranking (a purged guest): nothing to store
            self._conn.execute(
                "delete from user_feed_entry where user_id = %s", (user_id,)
            )
            # Items or moments deleted since ranking are skipped; the rank keeps the
            # order.
            for chip, ranked in by_chip.items():
                self._conn.execute(
                    f"""
                    insert into user_feed_entry
                      (user_id, chip, content_item_id, moment_id, rank, top_signal,
                       note_id, explore_kind, explore_arm, score_parts)
                    select %s, %s::break_length, r.item_id, r.moment_id, r.rank,
                           r.top_signal, r.note_id, r.explore_kind, r.explore_arm,
                           r.score_parts
                    {_RANKED_ROWS}
                    """,
                    (user_id, chip, *_ranked_arrays(ranked)),
                )
            self._conn.execute(
                "insert into user_feed_state (user_id, computed_at) values (%s, %s) "
                "on conflict (user_id) "
                "do update set computed_at = excluded.computed_at",
                (user_id, computed_at),
            )

    def replace_starter(
        self,
        topic: str,
        level: Difficulty,
        chip: BreakLength,
        ranked: list[RankedEntry],
    ) -> None:
        with self._conn.transaction():
            # Overlapping hourly runs (a slow one and the next) may rewrite it at once.
            self._conn.execute(
                "select pg_advisory_xact_lock(%s, hashtext(%s))",
                (FEED_LOCK_KEY, f"starter:{topic}:{level}:{chip}"),
            )
            self._conn.execute(
                "delete from starter_feed_entry "
                "where topic = %s and level = %s and chip = %s",
                (topic, level, chip),
            )
            self._conn.execute(
                f"""
                insert into starter_feed_entry
                  (topic, level, chip, content_item_id, moment_id, rank, note_id)
                select %s, %s, %s::break_length, r.item_id, r.moment_id, r.rank,
                       r.note_id
                {_RANKED_ROWS}
                """,
                (topic, level, chip, *_ranked_arrays(ranked)),
            )

    def active_users(self, since: datetime) -> list[str]:
        rows = self._conn.execute(
            "select distinct user_id from auth_session where updated_at >= %s "
            "order by user_id",
            (since,),
        ).fetchall()
        return [str(r[0]) for r in rows]


class PostgresInvites:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def issue(
        self,
        *,
        beta_group: BetaGroup,
        max_uses: int,
        expires_at: datetime,
        note: str | None,
        codes: list[str],
    ) -> list[str]:
        stored: list[str] = []
        try:
            with self._conn.transaction():
                for code in codes:
                    row = self._conn.execute(
                        "insert into invite_code "
                        "(code, beta_group, max_uses, expires_at, note) "
                        "values (normalize_invite_code(%s), %s, %s, %s, %s) "
                        "returning code",
                        (code, beta_group, max_uses, expires_at, note),
                    ).fetchone()
                    if row is None:
                        raise RuntimeError("insert returned no row")
                    stored.append(str(row[0]))
        except psycopg.errors.UniqueViolation as error:
            raise DuplicateInviteCode(str(error).splitlines()[0]) from error
        return stored


class PostgresUsers:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def purge_inactive_guests(self, now: datetime) -> int:
        cursor = self._conn.execute(
            """
            delete from app_user u
            where u.is_anonymous
              and not exists (
                select 1 from auth_session s
                where s.user_id = u.id and s.expires_at > %s
              )
            """,
            (now,),
        )
        return cursor.rowcount


class PostgresGrants:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def _account(self, email: str) -> str | None:
        row = self._conn.execute(
            "select id from app_user "
            "where email = lower(btrim(%s)) and not is_anonymous",
            (email,),
        ).fetchone()
        return None if row is None else str(row[0])

    def grant(self, email: str, capability: Capability) -> GrantResult:
        user_id = self._account(email)
        if user_id is None:
            return "no_account"
        limited = self._conn.execute(
            "select 1 from plan_capability "
            "where capability = %s and limit_value is not null",
            (capability,),
        ).fetchone()
        if limited is not None:
            return "limited"
        self._conn.execute(
            "insert into user_capability (user_id, capability) values (%s, %s) "
            "on conflict do nothing",
            (user_id, capability),
        )
        return "granted"

    def revoke(self, email: str, capability: Capability) -> RevokeResult:
        user_id = self._account(email)
        if user_id is None:
            return "no_account"
        removed = self._conn.execute(
            "delete from user_capability where user_id = %s and capability = %s",
            (user_id, capability),
        )
        return "revoked" if removed.rowcount > 0 else "not_granted"


class PostgresAi:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def daily_budget_cents(self, user_id: str | None) -> int | None:
        if user_id is None:
            row = self._conn.execute(
                "select daily_cents from ai_budget where scope = 'global'"
            ).fetchone()
            if row is None:
                raise RuntimeError("ai_budget has no global row (see migrations)")
            return int(row[0])
        row = self._conn.execute(
            "select limit_value from user_entitlement "
            "where user_id = %s and capability = 'ai.budget.daily_cents'",
            (user_id,),
        ).fetchone()
        if row is None:
            return 0  # no plan grants it: no AI for this user
        return None if row[0] is None else int(row[0])

    def spent_usd(
        self, user_id: str | None, day: date, *, excluding: Collection[AiProvider]
    ) -> Decimal:
        start = datetime.combine(day, time(), tzinfo=UTC)
        end = start + timedelta(days=1)
        # Two queries, so each one matches its own index (ai_usage_user_day and
        # ai_usage_offline_day).
        if user_id is None:
            row = self._conn.execute(
                "select coalesce(sum(cost_usd), 0) from ai_usage "
                "where is_offline and occurred_at >= %s and occurred_at < %s "
                "and provider <> all(%s::ai_provider[])",
                (start, end, list(excluding)),
            ).fetchone()
        else:
            row = self._conn.execute(
                "select coalesce(sum(cost_usd), 0) from ai_usage "
                "where user_id = %s and occurred_at >= %s and occurred_at < %s "
                "and provider <> all(%s::ai_provider[])",
                (user_id, start, end, list(excluding)),
            ).fetchone()
        assert row is not None  # an aggregate always returns one row
        return Decimal(row[0])

    def record(self, usage: Usage) -> None:
        self._conn.execute(
            "insert into ai_usage (occurred_at, user_id, is_offline, feature, "
            "provider, model, input_tokens, output_tokens, cost_usd) "
            "values (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                usage.occurred_at,
                usage.user_id,
                usage.user_id is None,
                usage.feature,
                usage.provider,
                usage.model,
                usage.input_tokens,
                usage.output_tokens,
                usage.cost_usd,
            ),
        )


class PostgresValidators:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def get(self, url: str) -> Validators | None:
        row = self._conn.execute(
            """
            select etag, last_modified from fetch_validator
            where url = %s and updated_at > now() - %s
            """,
            (url, VALIDATORS_MAX_AGE),
        ).fetchone()
        return None if row is None else Validators(row[0], row[1])

    def put(self, url: str, validators: Validators | None) -> None:
        if validators is None:
            self._conn.execute("delete from fetch_validator where url = %s", (url,))
            return
        self._conn.execute(
            """
            insert into fetch_validator (url, etag, last_modified)
            values (%s, %s, %s)
            on conflict (url) do update
              set etag = excluded.etag,
                  last_modified = excluded.last_modified,
                  updated_at = now()
            """,
            (url, validators.etag, validators.last_modified),
        )


class PostgresConcepts:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def state(self) -> ConceptGraph | None:
        row = self._conn.execute("select max(version) from graph_version").fetchone()
        if row is None or row[0] is None:
            return None
        version: int = row[0]
        concepts = [
            ConceptSeed(
                slug, name, topic, description, retired, merged_into, tuple(aliases)
            )
            for (
                slug,
                name,
                topic,
                description,
                retired,
                merged_into,
                aliases,
            ) in self._conn.execute(
                """
                select c.slug, c.name, c.topic, c.description, c.retired_at is not null,
                       m.slug, c.aliases
                from concept c left join concept m on m.id = c.merged_into
                order by c.slug
                """
            ).fetchall()
        ]
        edges: set[ConceptEdge] = {
            (str(a), str(b), kind)
            for a, b, kind in self._conn.execute(
                """
                select f.slug, t.slug, e.type
                from concept_edge e
                join concept f on f.id = e.from_id
                join concept t on t.id = e.to_id
                """
            ).fetchall()
        }
        return ConceptGraph(version, concepts, edges)

    def apply(self, graph: ConceptGraph) -> None:
        with self._conn.cursor() as cur:
            # One load at a time: two would race on replacing the edges.
            cur.execute("lock table graph_version in exclusive mode")
            cur.executemany(
                """
                insert into concept (slug, name, topic, description, aliases,
                                     retired_at)
                values (%(slug)s, %(name)s, %(topic)s, %(description)s, %(aliases)s,
                        case when %(retired)s then now() end)
                on conflict (slug) do update
                  set name = excluded.name,
                      topic = excluded.topic,
                      description = excluded.description,
                      aliases = excluded.aliases,
                      -- Keep the first retirement time; clear it on reactivation.
                      retired_at = case
                        when %(retired)s then coalesce(concept.retired_at, now())
                      end,
                      -- An active concept is merged into nothing (the row check).
                      merged_into = case when %(retired)s then concept.merged_into end
                """,
                [
                    {
                        "slug": c.slug,
                        "name": c.name,
                        "topic": c.topic,
                        "description": c.description,
                        "aliases": list(c.aliases),
                        "retired": c.retired,
                    }
                    for c in graph.concepts
                ],
            )
            cur.executemany(
                """
                update concept
                set merged_into = (select id from concept where slug = %s)
                where slug = %s and merged_into is distinct from (
                  select id from concept where slug = %s
                )
                """,
                [(c.merged_into, c.slug, c.merged_into) for c in graph.concepts],
            )
            cur.execute("delete from concept_edge")
            try:
                with self._conn.transaction():
                    cur.executemany(
                        """
                        insert into concept_edge (from_id, to_id, type)
                        select f.id, t.id, %s from concept f, concept t
                        where f.slug = %s and t.slug = %s
                        """,
                        [(kind, a, b) for a, b, kind in sorted(graph.edges)],
                    )
            except psycopg.errors.RaiseException as error:
                raise ConceptCycleError(str(error).splitlines()[0]) from error
            cur.execute(
                "insert into graph_version (version) values (%s) "
                "on conflict (version) do nothing",
                (graph.version,),
            )

    def vectors(self, model: str) -> dict[str, tuple[str, list[float]]]:
        rows = self._conn.execute(
            "select c.slug, e.text_hash, e.embedding::text from concept_embedding e "
            "join concept c on c.id = e.concept_id where e.model = %s",
            (model,),
        ).fetchall()
        return {
            str(r[0]): (str(r[1]), [float(x) for x in str(r[2]).strip("[]").split(",")])
            for r in rows
        }

    def save_vector(
        self, slug: str, model: str, text_hash: str, vector: list[float]
    ) -> None:
        saved = self._conn.execute(
            """
            insert into concept_embedding (concept_id, model, text_hash, embedding)
            select id, %s, %s, %s::vector from concept where slug = %s
            on conflict (concept_id, model) do update
              set text_hash = excluded.text_hash, embedding = excluded.embedding,
                  embedded_at = now()
            """,
            (model, text_hash, _vector(vector), slug),
        )
        if saved.rowcount != 1:
            raise ValueError(f"no concept {slug}")

    def get(self, slug: str) -> ConceptSeed | None:
        row = self._conn.execute(
            """
            select c.slug, c.name, c.topic, c.description, c.retired_at is not null,
                   m.slug, c.aliases
            from concept c left join concept m on m.id = c.merged_into
            where c.slug = %s
            """,
            (slug,),
        ).fetchone()
        if row is None:
            return None
        slug_, name, topic, description, retired, merged_into, aliases = row
        return ConceptSeed(
            slug_, name, topic, description, retired, merged_into, tuple(aliases)
        )

    def prerequisites(self, slug: str) -> set[str]:
        rows = self._conn.execute(
            """
            with recursive before(id) as (
              select e.from_id from concept_edge e
              join concept c on c.id = e.to_id
              where c.slug = %s and e.type = 'prerequisite_of'
              union
              select e.from_id from concept_edge e join before b on e.to_id = b.id
              where e.type = 'prerequisite_of'
            )
            select c.slug from concept c join before b on b.id = c.id
            where c.retired_at is null
            """,
            (slug,),
        ).fetchall()
        return {str(r[0]) for r in rows}


class PostgresItemTags:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def input(self, item_id: int) -> TagInput | None:
        row = self._conn.execute(
            """
            select ci.title, ci.feed_summary,
                   -- ING-2: body text only under the source's current rights.
                   case when s.rights_profile in
                     ('full_text_internal', 'full_text_display') then pt.text end,
                   case when s.rights_profile = 'excerpt' then ci.excerpt end,
                   it.prompt_version, ci.duplicate_of is not null
            from content_item ci
            join source s on s.id = ci.source_id
            left join content_item_private_text pt on pt.content_item_id = ci.id
            left join item_tagging it on it.content_item_id = ci.id
            where ci.id = %s
            """,
            (item_id,),
        ).fetchone()
        if row is None:
            return None
        title, summary, text, excerpt, version, duplicate = row
        moments = [
            TagMoment(int(m_id), int(ordinal), None if kind == "page_top" else title_)
            for m_id, ordinal, title_, kind in self._conn.execute(
                "select id, ordinal, title, link_type from moment "
                "where content_item_id = %s order by ordinal",
                (item_id,),
            ).fetchall()
        ]
        return TagInput(
            title, summary, text, excerpt, moments, version, bool(duplicate)
        )

    def version(self, item_id: int) -> int | None:
        row = self._conn.execute(
            "select prompt_version from item_tagging where content_item_id = %s",
            (item_id,),
        ).fetchone()
        return None if row is None else int(row[0])

    def needs_tagging(self, item_id: int, prompt_version: int) -> bool:
        row = self._conn.execute(
            """
            select ci.duplicate_of is null
               and it.prompt_version is distinct from %s
            from content_item ci
            left join item_tagging it on it.content_item_id = ci.id
            where ci.id = %s
            """,
            (prompt_version, item_id),
        ).fetchone()
        return bool(row and row[0])

    def clear(self, item_id: int) -> None:
        self._conn.execute(
            "delete from moment_tagging where moment_id in "
            "(select id from moment where content_item_id = %s)",
            (item_id,),
        )
        self._conn.execute(
            "delete from item_tagging where content_item_id = %s", (item_id,)
        )

    def find(self, canonical_url: str) -> int | None:
        row = self._conn.execute(
            "select id from content_item where canonical_url = %s "
            "order by duplicate_of is not null, id limit 1",
            (canonical_url,),
        ).fetchone()
        return None if row is None else int(row[0])

    def save(
        self, item_id: int, result: TagResult, model: str, prompt_version: int
    ) -> None:
        conn = self._conn
        owned = {
            int(r[0])
            for r in conn.execute(
                "select id from moment where content_item_id = %s", (item_id,)
            ).fetchall()
        }
        foreign = sorted(set(result.moments) - owned)
        if foreign:
            raise ValueError(f"moments {foreign} are not item {item_id}'s")
        conn.execute("delete from item_tagging where content_item_id = %s", (item_id,))
        conn.execute(
            "delete from moment_tagging where moment_id in "
            "(select id from moment where content_item_id = %s)",
            (item_id,),
        )
        conn.execute(
            "insert into item_tagging "
            "(content_item_id, difficulty, model, prompt_version) "
            "values (%s, %s, %s, %s)",
            (item_id, result.item.difficulty, model, prompt_version),
        )
        conn.execute(
            "insert into item_concept (content_item_id, concept_id) "
            "select %s, id from concept where slug = any(%s)",
            (item_id, sorted(result.item.concepts)),
        )
        for moment_id, tags in result.moments.items():
            conn.execute(
                "insert into moment_tagging (moment_id, difficulty) values (%s, %s)",
                (moment_id, tags.difficulty),
            )
            conn.execute(
                "insert into moment_concept (moment_id, concept_id) "
                "select %s, id from concept where slug = any(%s)",
                (moment_id, sorted(tags.concepts)),
            )

    def for_item(self, item_id: int) -> tuple[Tags | None, dict[int, Tags]]:
        row = self._conn.execute(
            """
            select it.difficulty,
                   coalesce(array_agg(c.slug) filter (where c.slug is not null), '{}')
            from item_tagging it
            left join item_concept ic on ic.content_item_id = it.content_item_id
            left join concept c on c.id = ic.concept_id
            where it.content_item_id = %s
            group by it.difficulty
            """,
            (item_id,),
        ).fetchone()
        item = None if row is None else Tags(row[0], frozenset(row[1]))
        moments = {
            int(ordinal): Tags(difficulty, frozenset(slugs))
            for ordinal, difficulty, slugs in self._conn.execute(
                """
                select m.ordinal, mt.difficulty,
                       coalesce(
                         array_agg(c.slug) filter (where c.slug is not null), '{}'
                       )
                from moment m
                join moment_tagging mt on mt.moment_id = m.id
                left join moment_concept mc on mc.moment_id = m.id
                left join concept c on c.id = mc.concept_id
                where m.content_item_id = %s
                group by m.ordinal, mt.difficulty
                """,
                (item_id,),
            ).fetchall()
        }
        return item, moments


def _vector(values: list[float]) -> str:
    # pgvector's text form; read and written as text, no adapter (P1-W3-S04).
    # pgvector stores float4, so nine significant digits keep every bit.
    return "[" + ",".join(format(float(v), ".9g") for v in values) + "]"


class PostgresEmbeddings:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def missing(self, item_id: int, model: str) -> bool:
        row = self._conn.execute(
            """
            select ci.duplicate_of is null
               and exists (select 1 from moment m where m.content_item_id = ci.id)
               and not exists (
                 select 1 from item_embedding ie
                 where ie.content_item_id = ci.id and ie.model = %s
               )
            from content_item ci where ci.id = %s
            """,
            (model, item_id),
        ).fetchone()
        return bool(row and row[0])

    def done(self, item_id: int, model: str) -> set[int]:
        rows = self._conn.execute(
            "select e.moment_id from moment_embedding e "
            "join moment m on m.id = e.moment_id "
            "where m.content_item_id = %s and e.model = %s",
            (item_id, model),
        ).fetchall()
        return {int(r[0]) for r in rows}

    def save(
        self,
        item_id: int,
        vectors: dict[int, list[float]],
        model: str,
        *,
        complete: bool,
    ) -> None:
        owned = {
            int(r[0])
            for r in self._conn.execute(
                "select id from moment where content_item_id = %s", (item_id,)
            ).fetchall()
        }
        foreign = sorted(set(vectors) - owned)
        if foreign:
            raise ValueError(f"moments {foreign} are not item {item_id}'s")
        with self._conn.cursor() as cur:
            cur.executemany(
                """
                insert into moment_embedding (moment_id, model, embedding)
                values (%s, %s, %s::vector)
                on conflict (moment_id) do update
                  set model = excluded.model,
                      embedding = excluded.embedding,
                      embedded_at = now()
                """,
                [(m, model, _vector(v)) for m, v in sorted(vectors.items())],
            )
        if complete:
            self._conn.execute(
                "insert into item_embedding (content_item_id, model) values (%s, %s) "
                "on conflict do nothing",
                (item_id, model),
            )

    def clear(self, item_id: int) -> None:
        self._conn.execute(
            "delete from moment_embedding where moment_id in "
            "(select id from moment where content_item_id = %s)",
            (item_id,),
        )
        self._conn.execute(
            "delete from item_embedding where content_item_id = %s", (item_id,)
        )

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
        # With filters, a plain HNSW scan returns at most ef_search candidates and
        # filters them afterwards; the iterative scan keeps going until `limit` match.
        self._conn.execute("set local hnsw.iterative_scan = strict_order")
        rows = self._conn.execute(
            """
            with shown_item as (
              -- Per duplicate group, the earliest copy that has moments: the one the
              -- feed shows (owner review, 2026-10-26).
              select distinct on (coalesce(c.duplicate_of, c.id)) c.id
              from content_item c
              where exists (select 1 from moment x where x.content_item_id = c.id)
                and c.link_broken_at is null  -- P1-W6-S03
              order by coalesce(c.duplicate_of, c.id), c.published_at nulls last, c.id
            )
            select e.moment_id, m.content_item_id, ci.source_id,
                   1 - (e.embedding <=> %(v)s::vector) as score
            from moment_embedding e
            join moment m on m.id = e.moment_id
            join content_item ci on ci.id = m.content_item_id
            join source s on s.id = ci.source_id
            left join moment_tagging t on t.moment_id = m.id
            -- An admin's correction wins over the model's level (P1-W3-S05).
            left join tag_override o
              on o.content_item_id = m.content_item_id
             and o.heading = m.title and m.link_type <> 'page_top'
            where s.rights_profile in ('full_text_internal', 'full_text_display')
              and (%(sources)s::bigint[] is null or s.id = any(%(sources)s))
              and (%(model)s::text is null or e.model = %(model)s)
              and s.active and ci.id in (select id from shown_item)
              and s.id <> all(%(no_sources)s) and ci.id <> all(%(no_items)s)
              and m.id <> all(%(no_moments)s)
              and (
                %(levels)s::difficulty[] is null
                or coalesce(o.difficulty, t.difficulty) = any(%(levels)s)
              )
            order by e.embedding <=> %(v)s::vector
            limit %(limit)s
            """,
            {
                "v": _vector(vector),
                "sources": source_ids,
                "levels": difficulties,
                "limit": limit,
                "model": model,
                "no_sources": sorted(exclude_sources or set()),
                "no_items": sorted(exclude_items or set()),
                "no_moments": sorted(exclude_moments),
            },
        ).fetchall()
        return [
            SimilarMoment(int(r[0]), int(r[1]), int(r[2]), float(r[3])) for r in rows
        ]

    def vectors_of_item(self, item_id: int, model: str) -> dict[int, list[float]]:
        rows = self._conn.execute(
            "select m.id, e.embedding::text from moment_embedding e "
            "join moment m on m.id = e.moment_id "
            "where m.content_item_id = %s and e.model = %s order by m.ordinal",
            (item_id, model),
        ).fetchall()
        return {
            int(r[0]): [float(x) for x in str(r[1]).strip("[]").split(",")]
            for r in rows
        }


# An item's concepts: the admin's correction replaces the model's tags (P1-W3-S05).
_ITEM_CONCEPTS = """
    select unnest(o.concepts) as slug from tag_override o
    where o.content_item_id = {item} and o.heading = ''
    union all
    select c.slug from item_concept ic join concept c on c.id = ic.concept_id
    where ic.content_item_id = {item} and not exists (
      select 1 from tag_override o2
      where o2.content_item_id = {item} and o2.heading = ''
    )
"""


# The item `ci` (its source `s`, its item-level override `o`) is on one of the topics.
_ON_TOPICS = """(
  s.topics && %(topics)s::text[]
  or exists (
    select 1 from concept c
    where c.topic = any(%(topics)s)
      and (
        -- An admin's correction replaces the model's tags (P1-W3-S05).
        (o.content_item_id is not null and c.slug = any(o.concepts))
        or (o.content_item_id is null and c.id in (
          select concept_id from item_concept where content_item_id = ci.id
        ))
      )
  )
)"""


class PostgresRankingInputs:
    """What the web app writes about a user, read for ranking (P1-W4-S02)."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def preferences(self, user_id: str) -> UserPreferences | None:
        # psycopg doesn't parse arrays of an unregistered enum type: read as text[].
        row = self._conn.execute(
            "select topics::text[], level, break_length::text, "
            # The enum's own order, which LEARNING_GOALS mirrors.
            "array(select u.goal::text from unnest(goals) as u(goal) order by u.goal) "
            "from user_preferences where user_id = %s",
            (user_id,),
        ).fetchone()
        if row is None:
            return None
        # The column's enum types guarantee these values.
        unknown = sorted(set(row[0]) - TOPICS)
        if unknown:
            raise ValueError(
                f"user_preferences holds topics the worker lacks: {unknown}"
            )
        return UserPreferences(
            topics=[cast(Topic, t) for t in row[0]],
            level=row[1],
            break_length=cast(BreakLength, row[2]),
            goals=[cast(LearningGoal, g) for g in row[3]],
        )

    def goal_concepts(
        self, goals: list[LearningGoal]
    ) -> dict[LearningGoal, frozenset[str]]:
        rows = self._conn.execute(
            "select goal::text, concept_slug from goal_concept "
            "where goal = any(%s::learning_goal[])",
            (list(goals),),
        ).fetchall()
        found: dict[LearningGoal, set[str]] = {}
        for goal, slug in rows:
            found.setdefault(cast(LearningGoal, goal), set()).add(str(slug))
        return {goal: frozenset(slugs) for goal, slugs in found.items()}

    def hidden_sources(self, user_id: str) -> set[int]:
        rows = self._conn.execute(
            "select source_id from user_hidden_source where user_id = %s", (user_id,)
        ).fetchall()
        return {int(r[0]) for r in rows}

    def not_interested(self, user_id: str) -> set[int]:
        rows = self._conn.execute(
            "select content_item_id from item_feedback "
            "where user_id = %s and kind = 'not_interested'",
            (user_id,),
        ).fetchall()
        return {int(r[0]) for r in rows}

    def anchor_items(self, user_id: str, limit: int) -> list[int]:
        rows = self._conn.execute(
            """
            select content_item_id from (
              -- Each item once, at its strongest: More like this before a save.
              select distinct on (content_item_id) content_item_id, tier, at from (
                select content_item_id, 0 as tier, given_at as at from item_feedback
                where user_id = %(user)s and kind = 'more_like_this'
                union all
                select content_item_id, 1, saved_at from user_save
                where user_id = %(user)s
              ) a
              order by content_item_id, tier, at desc
            ) best
            order by tier, at desc
            limit %(limit)s
            """,
            {"user": user_id, "limit": limit},
        ).fetchall()
        return [int(r[0]) for r in rows]

    def less_liked(self, user_id: str) -> set[int]:
        rows = self._conn.execute(
            "select content_item_id from item_feedback "
            "where user_id = %s and kind = 'less_like_this'",
            (user_id,),
        ).fetchall()
        return {int(r[0]) for r in rows}

    def avoided_concepts(self, user_id: str) -> frozenset[str]:
        # The view the Profile page also reads (P1-W4-S08): it honours a reset.
        rows = self._conn.execute(
            "select slug from user_avoided_concept where user_id = %s", (user_id,)
        ).fetchall()
        return frozenset(str(r[0]) for r in rows)

    def config(self) -> dict[str, float]:
        rows = self._conn.execute("select key, value from ranking_config").fetchall()
        return {str(r[0]): float(r[1]) for r in rows}

    def finished(self, user_id: str) -> Finished:
        moments = self._conn.execute(
            "select moment_id from user_moment_finished where user_id = %s",
            (user_id,),
        ).fetchall()
        items = self._conn.execute(
            "select content_item_id from user_article_finished where user_id = %s",
            (user_id,),
        ).fetchall()
        return Finished(
            frozenset(int(r[0]) for r in moments), frozenset(int(r[0]) for r in items)
        )

    def arm_outcomes(self) -> dict[Arm, ArmOutcome]:
        rows = self._conn.execute(
            "select kind, arm, shown, finished from explore_arm_outcome"
        ).fetchall()
        return {Arm(r[0], r[1]): ArmOutcome(int(r[2]), int(r[3])) for r in rows}

    def moment_facts(self, moment_ids: list[int]) -> dict[int, EntryFacts]:
        rows = self._conn.execute(
            f"""
            select m.id, ci.id, s.id, m.estimated_minutes,
                   -- Human before model (owner, 2026-10-26): the admin's moment level,
                   -- the admin's item level, the model's moment tag, its item tag.
                   coalesce(mo.difficulty, io.difficulty, mt.difficulty, it.difficulty),
                   ci.published_at, s.quality_score,
                   array(select slug from ({_ITEM_CONCEPTS.format(item="ci.id")}) c),
                   s.topics || array(
                     select k.topic from concept k
                     where k.slug in (
                       select slug from ({_ITEM_CONCEPTS.format(item="ci.id")}) c2
                     )
                   ),
                   s.name
            from moment m
            join content_item ci on ci.id = m.content_item_id
            join source s on s.id = ci.source_id
            left join moment_tagging mt on mt.moment_id = m.id
            left join tag_override mo on mo.content_item_id = ci.id
              and mo.heading = m.title and m.link_type <> 'page_top'
            left join tag_override io on io.content_item_id = ci.id and io.heading = ''
            left join item_tagging it on it.content_item_id = ci.id
            where m.id = any(%s)
            """,
            (moment_ids,),
        ).fetchall()
        return {
            int(r[0]): EntryFacts(
                int(r[0]),
                int(r[1]),
                int(r[2]),
                int(r[3]),
                r[4],
                r[5],
                r[6],
                frozenset(str(c) for c in r[7]),
                frozenset(str(t) for t in r[8]),
                str(r[9]),
            )
            for r in rows
        }

    def topic_moments(
        self,
        topics: list[Topic],
        limit: int,
        *,
        exclude_sources: set[int],
        exclude_items: set[int],
        exclude_moments: frozenset[int] = frozenset(),
    ) -> list[CandidateMoment]:
        rows = self._conn.execute(
            f"""
            with shown_item as (
              -- Per duplicate group, the earliest copy that has moments: the one the
              -- feed shows (owner review, 2026-10-26).
              select distinct on (coalesce(c.duplicate_of, c.id)) c.id
              from content_item c
              where exists (select 1 from moment x where x.content_item_id = c.id)
                and c.link_broken_at is null  -- P1-W6-S03
              order by coalesce(c.duplicate_of, c.id), c.published_at nulls last, c.id
            )
            select m.id, ci.id, s.id
            from moment m
            join content_item ci on ci.id = m.content_item_id
            join source s on s.id = ci.source_id
            left join tag_override o
              on o.content_item_id = ci.id and o.heading = ''
            where ci.id in (select id from shown_item) and s.active
              and s.id <> all(%(sources)s) and ci.id <> all(%(items)s)
              and m.id <> all(%(moments)s)
              and {_ON_TOPICS}
            order by ci.published_at desc nulls last, ci.id desc, m.ordinal
            limit %(limit)s
            """,
            {
                "topics": list(topics),
                "sources": sorted(exclude_sources),
                "items": sorted(exclude_items),
                "moments": sorted(exclude_moments),
                "limit": limit,
            },
        ).fetchall()
        return [CandidateMoment(int(r[0]), int(r[1]), int(r[2])) for r in rows]

    def article_facts(self, item_ids: list[int]) -> dict[int, EntryFacts]:
        rows = self._conn.execute(
            f"""
            select ci.id, s.id, item_minutes(ci.id),
                   -- Human before model, as moment_facts: the admin's item level, else
                   -- the model's item tag.
                   coalesce(io.difficulty, it.difficulty),
                   ci.published_at, s.quality_score,
                   array(select slug from ({_ITEM_CONCEPTS.format(item="ci.id")}) c),
                   s.topics || array(
                     select k.topic from concept k
                     where k.slug in (
                       select slug from ({_ITEM_CONCEPTS.format(item="ci.id")}) c2
                     )
                   ),
                   s.name
            from content_item ci
            join source s on s.id = ci.source_id
            left join tag_override io on io.content_item_id = ci.id and io.heading = ''
            left join item_tagging it on it.content_item_id = ci.id
            where ci.id = any(%s)
            """,
            (item_ids,),
        ).fetchall()
        return {
            int(r[0]): EntryFacts(
                None,
                int(r[0]),
                int(r[1]),
                r[2],
                r[3],
                r[4],
                r[5],
                frozenset(str(c) for c in r[6]),
                frozenset(str(t) for t in r[7]),
                str(r[8]),
            )
            for r in rows
        }

    def topic_articles(
        self,
        topics: list[Topic],
        limit: int,
        *,
        exclude_sources: set[int],
        exclude_items: set[int],
    ) -> list[CandidateArticle]:
        rows = self._conn.execute(
            f"""
            with shown_item as (
              -- Per duplicate group, the copy whose moments the feed shows, else the
              -- earliest: one story is one card.
              select distinct on (coalesce(c.duplicate_of, c.id)) c.id
              from content_item c
              where c.link_broken_at is null  -- P1-W6-S03
              order by coalesce(c.duplicate_of, c.id),
                not exists (select 1 from moment x where x.content_item_id = c.id),
                c.published_at nulls last, c.id
            )
            select ci.id, s.id
            from content_item ci
            join source s on s.id = ci.source_id
            left join tag_override o
              on o.content_item_id = ci.id and o.heading = ''
            where ci.id in (select id from shown_item) and s.active
              and s.id <> all(%(sources)s) and ci.id <> all(%(items)s)
              and {_ON_TOPICS}
            order by ci.published_at desc nulls last, ci.id desc
            limit %(limit)s
            """,
            {
                "topics": list(topics),
                "sources": sorted(exclude_sources),
                "items": sorted(exclude_items),
                "limit": limit,
            },
        ).fetchall()
        return [CandidateArticle(int(r[0]), int(r[1])) for r in rows]


class PostgresDecisions:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def _known(self, probabilities: dict[str, float]) -> None:
        found = {
            str(r[0])
            for r in self._conn.execute(
                "select slug from concept where slug = any(%s)", (list(probabilities),)
            ).fetchall()
        }
        unknown = sorted(set(probabilities) - found)
        if unknown:
            raise ValueError(f"no concept {unknown[0]}")

    def moment_hashes(self, item_id: int, model: str) -> dict[int, str]:
        rows = self._conn.execute(
            "select d.moment_id, d.content_hash from moment_decision d "
            "join moment m on m.id = d.moment_id "
            "where m.content_item_id = %s and d.model = %s",
            (item_id, model),
        ).fetchall()
        return {int(r[0]): str(r[1]) for r in rows}

    def save_moment(
        self,
        moment_id: int,
        model: str,
        content_hash: str,
        difficulty: float,
        probabilities: dict[str, float],
    ) -> None:
        self._known(probabilities)
        # An upsert, so a second writer (the pipeline and an eval run) waits on the
        # row's lock and then replaces the answers instead of failing on the key.
        self._conn.execute(
            """
            insert into moment_decision (moment_id, model, content_hash, difficulty)
            values (%s, %s, %s, %s)
            on conflict (moment_id, model) do update
              set content_hash = excluded.content_hash,
                  difficulty = excluded.difficulty,
                  decided_at = now()
            """,
            (moment_id, model, content_hash, difficulty),
        )
        self._conn.execute(
            "delete from moment_concept_probability "
            "where moment_id = %s and model = %s",
            (moment_id, model),
        )
        with self._conn.cursor() as cur:
            cur.executemany(
                """
                insert into moment_concept_probability
                  (moment_id, model, concept_id, probability)
                select %s, %s, id, %s from concept where slug = %s
                """,
                [(moment_id, model, p, slug) for slug, p in probabilities.items()],
            )

    def item_hash(self, item_id: int, model: str) -> str | None:
        row = self._conn.execute(
            "select content_hash from item_decision "
            "where content_item_id = %s and model = %s",
            (item_id, model),
        ).fetchone()
        return None if row is None else str(row[0])

    def save_item(
        self,
        item_id: int,
        model: str,
        content_hash: str,
        difficulty: float,
        probabilities: dict[str, float],
    ) -> None:
        self._known(probabilities)
        # An upsert for the same reason as save_moment.
        self._conn.execute(
            """
            insert into item_decision (content_item_id, model, content_hash, difficulty)
            values (%s, %s, %s, %s)
            on conflict (content_item_id, model) do update
              set content_hash = excluded.content_hash,
                  difficulty = excluded.difficulty,
                  decided_at = now()
            """,
            (item_id, model, content_hash, difficulty),
        )
        self._conn.execute(
            "delete from item_concept_probability "
            "where content_item_id = %s and model = %s",
            (item_id, model),
        )
        with self._conn.cursor() as cur:
            cur.executemany(
                """
                insert into item_concept_probability
                  (content_item_id, model, concept_id, probability)
                select %s, %s, id, %s from concept where slug = %s
                """,
                [(item_id, model, p, slug) for slug, p in probabilities.items()],
            )

    def read(self, item_id: int, model: str) -> ItemDecisions:
        moments: dict[int, tuple[float, dict[str, float]]] = {
            int(r[0]): (float(r[1]), {})
            for r in self._conn.execute(
                "select d.moment_id, d.difficulty from moment_decision d "
                "join moment m on m.id = d.moment_id "
                "where m.content_item_id = %s and d.model = %s",
                (item_id, model),
            ).fetchall()
        }
        for moment_id, slug, probability in self._conn.execute(
            """
            select p.moment_id, c.slug, p.probability
            from moment_concept_probability p
            join concept c on c.id = p.concept_id
            join moment m on m.id = p.moment_id
            where m.content_item_id = %s and p.model = %s
            """,
            (item_id, model),
        ).fetchall():
            moments[int(moment_id)][1][str(slug)] = float(probability)
        found = self._conn.execute(
            "select difficulty from item_decision "
            "where content_item_id = %s and model = %s",
            (item_id, model),
        ).fetchone()
        item = {
            str(r[0]): float(r[1])
            for r in self._conn.execute(
                """
                select c.slug, p.probability from item_concept_probability p
                join concept c on c.id = p.concept_id
                where p.content_item_id = %s and p.model = %s
                """,
                (item_id, model),
            ).fetchall()
        }
        return ItemDecisions(moments, item, None if found is None else float(found[0]))


# A moment's live concepts, as crediting mastery reads them: an admin's correction
# replaces the model's tags (P1-W3-S05), by heading and never for the intro; retired
# concepts don't count. `m` is the moment.
_MOMENT_LIVE_CONCEPTS = """
    select c.slug, c.name from concept c
    where c.retired_at is null and c.slug = any(coalesce(
      (select o.concepts from tag_override o
       where o.content_item_id = m.content_item_id
         and o.heading = m.title and m.link_type <> 'page_top'),
      array(select c2.slug from moment_concept mc
            join concept c2 on c2.id = mc.concept_id where mc.moment_id = m.id)
    ))
"""

# Moments questions may be drafted for (Q-P2-09): not a duplicate's, full-text rights
# with moments on (ING-2), and some live concept.
_QUESTION_TARGETS = f"""
    select m.id, m.content_item_id,
           coalesce(lo.difficulty, t.difficulty) as difficulty
    from moment m
    join content_item ci on ci.id = m.content_item_id
    join source s on s.id = ci.source_id
    left join moment_tagging t on t.moment_id = m.id
    -- An admin's correction wins over the model's level (P1-W3-S05).
    left join tag_override lo
      on lo.content_item_id = m.content_item_id
     and lo.heading = m.title and m.link_type <> 'page_top'
    where ci.duplicate_of is null and s.moments_enabled
      and s.rights_profile in ('full_text_internal', 'full_text_display')
      and exists ({_MOMENT_LIVE_CONCEPTS})
"""


class PostgresQuestions:
    """The question bank (Q-1, P2-W8-S01)."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def target(self, moment_id: int) -> QuestionTarget | None:
        found = self._conn.execute(
            f"{_QUESTION_TARGETS} and m.id = %s", (moment_id,)
        ).fetchone()
        if found is None:
            return None
        concepts = self._conn.execute(
            f"select slug, name from moment m, lateral ({_MOMENT_LIVE_CONCEPTS}) c "
            "where m.id = %s order by slug",
            (moment_id,),
        ).fetchall()
        return QuestionTarget(
            moment_id,
            int(found[1]),
            tuple((str(slug), str(name)) for slug, name in concepts),
            None if found[2] is None else cast(Difficulty, found[2]),
        )

    def targets(self, item_id: int | None) -> list[int]:
        rows = self._conn.execute(
            f"{_QUESTION_TARGETS} and (%(item)s::bigint is null "
            "or m.content_item_id = %(item)s) order by m.content_item_id, m.ordinal",
            {"item": item_id},
        ).fetchall()
        return [int(r[0]) for r in rows]

    def drafted_hash(self, moment_id: int) -> str | None:
        row = self._conn.execute(
            "select content_hash from question "
            "where moment_id = %s and status <> 'retired' limit 1",
            (moment_id,),
        ).fetchone()
        return None if row is None else str(row[0])

    def save(
        self,
        moment_id: int,
        drafts: Sequence[QuestionDraft],
        concepts: Sequence[str],
        model: str,
        prompt_version: int,
        content_hash: str,
        difficulty: Difficulty | None,
    ) -> list[int]:
        self._conn.execute(
            "update question set status = 'retired' "
            "where moment_id = %s and status <> 'retired'",
            (moment_id,),
        )
        self.clear_retry(moment_id)
        ids: list[int] = []
        for ordinal, draft in enumerate(drafts):
            row = self._conn.execute(
                """
                insert into question (moment_id, ordinal, stem, options, correct,
                  citation, generator_model, prompt_version, content_hash, difficulty)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                returning id
                """,
                (
                    moment_id,
                    ordinal,
                    draft.stem,
                    list(draft.options),
                    draft.correct,
                    draft.citation,
                    model,
                    prompt_version,
                    content_hash,
                    difficulty,
                ),
            ).fetchone()
            assert row is not None  # insert ... returning always returns the row
            ids.append(int(row[0]))
            self._conn.execute(
                """
                insert into question_concept (question_id, concept_id)
                select %s, id from concept where slug = any(%s)
                """,
                (row[0], list(concepts)),
            )
        return ids

    def retry_state(self, moment_id: int) -> tuple[int, datetime] | None:
        row = self._conn.execute(
            "select attempt, retry_at from question_drafting where moment_id = %s",
            (moment_id,),
        ).fetchone()
        return None if row is None else (int(row[0]), row[1])

    def record_retry(self, moment_id: int, attempt: int, retry_at: datetime) -> None:
        self._conn.execute(
            """
            insert into question_drafting (moment_id, attempt, retry_at)
            values (%s, %s, %s)
            on conflict (moment_id) do update
              set attempt = excluded.attempt, retry_at = excluded.retry_at
            """,
            (moment_id, attempt, retry_at),
        )

    def clear_retry(self, moment_id: int) -> None:
        self._conn.execute(
            "delete from question_drafting where moment_id = %s", (moment_id,)
        )

    def pending(self, question_id: int) -> tuple[int, QuestionDraft] | None:
        row = self._conn.execute(
            "select moment_id, stem, options, correct, citation from question "
            "where id = %s and status = 'pending'",
            (question_id,),
        ).fetchone()
        if row is None:
            return None
        moment_id, stem, options, correct, citation = row
        return int(moment_id), QuestionDraft(
            str(stem), tuple(str(o) for o in options), int(correct), str(citation)
        )

    def pending_ids(self, moment_id: int) -> list[int]:
        rows = self._conn.execute(
            "select id from question where moment_id = %s and status = 'pending' "
            "order by ordinal",
            (moment_id,),
        ).fetchall()
        return [int(r[0]) for r in rows]

    def record_verdict(self, question_id: int, model: str, answer: int) -> bool:
        row = self._conn.execute(
            """
            update question set
              status = case when correct = %(answer)s then 'live' else 'rejected' end
                ::question_status,
              validator_model = %(model)s,
              validator_answer = %(answer)s,
              validated_at = now()
            where id = %(id)s and status = 'pending'
            returning id
            """,
            {"id": question_id, "model": model, "answer": answer},
        ).fetchone()
        return row is not None

    def calibration_answers(self) -> list[Answer]:
        rows = self._conn.execute(
            """
            select a.user_id, qa.question_id, qa.correct
            from quiz_answer qa
            join quiz_attempt a on a.id = qa.attempt_id
            join question q on q.id = qa.question_id
            -- Test 60s answers only (sprints have an article): a review repeats
            -- questions the user has seen, spaced to be recalled, and a checkpoint
            -- comes right after the readings and repeats its small pool on a retry;
            -- both would make questions look easier.
            where qa.answered_at is not null and a.content_item_id is not null
              and q.status in ('live', 'flagged')
            """
        ).fetchall()
        return [Answer(str(user), int(qid), bool(right)) for user, qid, right in rows]

    def save_levels(self, levels: Mapping[int, Difficulty]) -> int:
        if not levels:
            return 0
        with self._conn.cursor() as cur:
            cur.executemany(
                "update question set difficulty = %s::difficulty, "
                "calibrated_at = now() where id = %s",
                [(level, qid) for qid, level in levels.items()],
            )
            return cur.rowcount

    def queue_anomalies(self, question_ids: Collection[int]) -> int:
        rows = self._conn.execute(
            """
            insert into question_review (question_id, reason)
            select id, 'anomaly' from unnest(%s::bigint[]) as ids(id)
            where not exists (
              select 1 from question_review r
              where r.question_id = ids.id
                and (r.decision is null or r.reason = 'anomaly')
            )
            on conflict (question_id) where decision is null do nothing
            returning question_id
            """,
            (list(question_ids),),
        ).fetchall()
        return len(rows)

    def queue_spot_checks(self, since: datetime, share: float) -> tuple[int, int]:
        # Two runs at once would sample the same window twice.
        self._conn.execute("select pg_advisory_xact_lock(hashtext('spot-checks'))")
        # The window is what went live since `since` (validated, whatever it is now), so
        # retiring a sampled question doesn't make a rerun draw another. A book
        # chapter's questions are its owner's alone (P2-W11-S06): never sampled.
        sampled = self._conn.execute(
            """
            with window_q as (
              select id, status from question
              where validated_at >= %(since)s and status <> 'rejected'
                and book_chapter_id is null
            ), taken as (
              select count(distinct r.question_id) as n from question_review r
              join window_q w on w.id = r.question_id where r.reason = 'sample'
            )
            insert into question_review (question_id, reason)
            select w.id, 'sample' from window_q w
            where w.status = 'live' and not exists (
              select 1 from question_review r
              where r.question_id = w.id and (r.reason = 'sample' or r.decision is null)
            )
            order by random()
            limit greatest(
              0,
              ceil(%(share)s * (select count(*) from window_q))::int
                - (select n from taken)
            )
            returning question_id
            """,
            {"since": since, "share": share},
        ).fetchall()
        # Every flagged question without an open review: one kept before and flagged
        # again goes back in.
        flagged = self._conn.execute(
            """
            insert into question_review (question_id, reason)
            select id, 'flagged' from question q
            where q.status = 'flagged' and q.book_chapter_id is null and not exists (
              select 1 from question_review r
              where r.question_id = q.id and r.decision is null
            )
            returning question_id
            """
        ).fetchall()
        return len(sampled), len(flagged)

    def pending_questions(self) -> list[int]:
        rows = self._conn.execute(
            "select id from question where status = 'pending' order by created_at, id"
        ).fetchall()
        return [int(r[0]) for r in rows]

    def record_batch(
        self,
        batch_id: str,
        kind: BatchKind,
        model: str,
        entries: Sequence[QuestionBatchEntry],
    ) -> None:
        self._conn.execute(
            "insert into question_batch (id, kind, model) values (%s, %s, %s)",
            (batch_id, kind, model),
        )
        with self._conn.cursor() as cur:
            cur.executemany(
                """
                insert into question_batch_item
                  (batch_id, custom_id, moment_id, question_id, content_hash)
                values (%s, %s, %s, %s, %s)
                """,
                [
                    (batch_id, e.custom_id, e.moment_id, e.question_id, e.content_hash)
                    for e in entries
                ],
            )

    def open_batches(self) -> list[tuple[str, BatchKind, datetime]]:
        rows = self._conn.execute(
            "select id, kind, submitted_at from question_batch where closed_at is null "
            "order by submitted_at, id"
        ).fetchall()
        return [(str(r[0]), cast(BatchKind, r[1]), r[2]) for r in rows]

    def batch_entries(self, batch_id: str) -> list[QuestionBatchEntry]:
        rows = self._conn.execute(
            """
            select custom_id, moment_id, question_id, content_hash
            from question_batch_item where batch_id = %s order by custom_id
            """,
            (batch_id,),
        ).fetchall()
        return [
            QuestionBatchEntry(
                str(cid),
                None if mid is None else int(mid),
                None if qid is None else int(qid),
                None if digest is None else str(digest),
            )
            for cid, mid, qid, digest in rows
        ]

    def in_open_batches(self) -> tuple[set[int], set[int]]:
        rows = self._conn.execute(
            """
            select i.moment_id, i.question_id from question_batch_item i
            join question_batch b on b.id = i.batch_id where b.closed_at is null
            """
        ).fetchall()
        return (
            {int(m) for m, _ in rows if m is not None},
            {int(q) for _, q in rows if q is not None},
        )

    def claim_batch_cost(self, batch_id: str, cost_usd: Decimal) -> bool:
        row = self._conn.execute(
            "update question_batch set cost_usd = %s "
            "where id = %s and cost_usd is null returning id",
            (cost_usd, batch_id),
        ).fetchone()
        return row is not None

    def close_batch(
        self,
        batch_id: str,
        outcome: Literal["completed", "failed"],
        results: Mapping[str, BatchItemResult],
    ) -> None:
        self._conn.execute(
            "update question_batch set closed_at = now(), outcome = %s where id = %s",
            (outcome, batch_id),
        )
        with self._conn.cursor() as cur:
            cur.executemany(
                "update question_batch_item set result = %s "
                "where batch_id = %s and custom_id = %s",
                [(result, batch_id, cid) for cid, result in results.items()],
            )

    def broken_counts(self) -> tuple[dict[tuple[int, str], int], dict[int, int]]:
        rows = self._conn.execute(
            "select moment_id, content_hash, question_id, count(*) "
            "from question_batch_item where result = 'broken' "
            "group by moment_id, content_hash, question_id"
        ).fetchall()
        return (
            {
                (int(m), str(h)): int(n)
                for m, h, _, n in rows
                if m is not None and h is not None
            },
            {int(q): int(n) for _, _, q, n in rows if q is not None},
        )

    def summary(self, sample: int) -> QuestionSummary:
        counts = {
            str(status): int(n)
            for status, n in self._conn.execute(
                "select status, count(*) from question "
                "where status <> 'retired' and book_chapter_id is null group by status"
            ).fetchall()
        }
        rows = self._conn.execute(
            """
            select id, stem, options, correct, citation, validator_answer, status
            from question where validated_at is not null and status <> 'retired'
              and book_chapter_id is null
            order by random() limit %s
            """,
            (sample,),
        ).fetchall()
        return QuestionSummary(
            counts,
            [
                ValidatedQuestion(
                    int(qid),
                    QuestionDraft(
                        str(stem), tuple(str(o) for o in options), int(key), str(cite)
                    ),
                    int(answer),
                    str(status),
                )
                for qid, stem, options, key, cite, answer, status in rows
            ],
        )


# Allowed moments (as question targets: ING-2, not a duplicate's) with their live
# concepts (an admin's tag correction winning), one row per moment and concept.
_PATH_MOMENTS = f"""
    select m.id as moment_id, ci.source_id, coalesce(ci.frameable, false) as frameable,
           c.slug
    from moment m
    join content_item ci on ci.id = m.content_item_id
    join source s on s.id = ci.source_id
    cross join lateral ({_MOMENT_LIVE_CONCEPTS}) c
    where ci.duplicate_of is null and s.moments_enabled
      and s.rights_profile in ('full_text_internal', 'full_text_display')
"""


class PostgresPaths:
    """Path proposals (§5F, P2-W10-S01)."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def coverage(self) -> list[ConceptCoverage]:
        rows = self._conn.execute(
            f"""
            with allowed as ({_PATH_MOMENTS})
            select c.slug, c.name, c.topic,
                   count(distinct a.moment_id), count(distinct a.source_id)
            from concept c
            left join allowed a on a.slug = c.slug
            where c.retired_at is null
            group by c.slug, c.name, c.topic
            order by c.slug
            """
        ).fetchall()
        return [
            ConceptCoverage(str(slug), str(name), str(topic), int(n), int(sources))
            for slug, name, topic, n, sources in rows
        ]

    def prerequisites(self) -> set[tuple[str, str]]:
        rows = self._conn.execute(
            """
            select a.slug, b.slug from concept_edge e
            join concept a on a.id = e.from_id and a.retired_at is null
            join concept b on b.id = e.to_id and b.retired_at is null
            where e.type = 'prerequisite_of'
            """
        ).fetchall()
        return {(str(a), str(b)) for a, b in rows}

    def session_candidates(self, slugs: Collection[str]) -> list[SessionCandidate]:
        rows = self._conn.execute(
            f"""
            with allowed as ({_PATH_MOMENTS})
            select a.moment_id, a.source_id, a.frameable, array_agg(a.slug),
                   exists (select 1 from question q
                           where q.moment_id = a.moment_id and q.status = 'live')
            from allowed a
            where a.moment_id in (
              select moment_id from allowed where slug = any(%s)
            )
            group by a.moment_id, a.source_id, a.frameable
            order by a.moment_id
            """,
            (list(slugs),),
        ).fetchall()
        return [
            SessionCandidate(
                int(moment),
                frozenset(str(s) for s in concepts),
                int(source),
                bool(frameable),
                bool(live),
            )
            for moment, source, frameable, concepts, live in rows
        ]

    def save_draft(self, draft: PathDraft, model: str, prompt_version: int) -> int:
        row = self._conn.execute(
            "insert into path (name, why, model, prompt_version) "
            "values (%s, %s, %s, %s) returning id",
            (draft.name, draft.why, model, prompt_version),
        ).fetchone()
        assert row is not None  # insert ... returning gives one row
        path_id = int(row[0])
        for ordinal, section in enumerate(draft.sections):
            found = self._conn.execute(
                "insert into path_section (path_id, ordinal) values (%s, %s) "
                "returning id",
                (path_id, ordinal),
            ).fetchone()
            assert found is not None
            section_id = int(found[0])
            linked = self._conn.execute(
                "insert into path_section_concept (section_id, concept_id) "
                "select %s, id from concept where slug = any(%s)",
                (section_id, list(section.concepts)),
            )
            # The proposer checked these against the live concepts moments ago.
            if linked.rowcount != len(set(section.concepts)):
                raise ValueError(f"unknown concepts in {section.concepts}")
            with self._conn.cursor() as cur:
                cur.executemany(
                    "insert into path_session (section_id, ordinal, moment_id) "
                    "values (%s, %s, %s)",
                    [(section_id, i, m) for i, m in enumerate(section.moment_ids)],
                )
        return path_id


class PostgresBooks:
    """PDF books (§5F, ING-5, P2-W11-S02): a user's private pages, chapters and
    sessions, read from their PDF by the book_process stage."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def for_processing(self, book_id: int) -> BookJob | None:
        row = self._conn.execute(
            # A second delivery while the first still runs skips it, not parses twice.
            "select user_id, file_key, title from book "
            "where id = %s and status = 'processing' for update skip locked",
            (book_id,),
        ).fetchone()
        if row is None:
            return None
        return BookJob(book_id, str(row[0]), str(row[1]), str(row[2]))

    def max_pages(self, user_id: str) -> int | None:
        row = self._conn.execute(
            "select limit_value from user_entitlement "
            "where user_id = %s and capability = 'books.max_pages'",
            (user_id,),
        ).fetchone()
        # No row: not granted (OPS-3); a null limit: no limit.
        if row is None:
            return 0
        return None if row[0] is None else int(row[0])

    def save(
        self,
        book_id: int,
        title: str | None,
        pages: list[BookPageText],
        chapters: list[BookChapterRow],
        status: Literal["ready", "ocr"],
    ) -> None:
        conn = self._conn
        # A rerun (or S03's rebuild after OCR) replaces what an earlier run made.
        conn.execute("delete from book_chapter where book_id = %s", (book_id,))
        conn.execute("delete from book_page where book_id = %s", (book_id,))
        with conn.cursor() as cur:
            cur.executemany(
                "insert into book_page (book_id, page_no, text, scanned) "
                "values (%s, %s, %s, %s)",
                [(book_id, p.page_no, p.text, p.scanned) for p in pages],
            )
        for ordinal, chapter in enumerate(chapters):
            chapter_row = conn.execute(
                "insert into book_chapter (book_id, ordinal, title) "
                "values (%s, %s, %s) returning id",
                (book_id, ordinal, chapter.title[:300]),
            ).fetchone()
            assert chapter_row is not None
            with conn.cursor() as cur:
                cur.executemany(
                    "insert into book_session (chapter_id, ordinal, title, text, "
                    "estimated_minutes, first_page, last_page) "
                    "values (%s, %s, %s, %s, %s, %s, %s)",
                    [
                        (
                            chapter_row[0],
                            n,
                            s.title[:300],
                            s.text,
                            max(1, s.minutes),
                            s.first_page,
                            s.last_page,
                        )
                        for n, s in enumerate(chapter.sessions)
                    ],
                )
        conn.execute(
            "update book set status = %s, page_count = %s, failure = null, "
            "title = coalesce(left(%s, 300), title) where id = %s",
            (status, len(pages), title, book_id),
        )

    def fail(self, book_id: int, reason: str) -> None:
        self._conn.execute(
            "update book set status = 'failed', failure = %s where id = %s",
            (reason, book_id),
        )

    def for_ocr(self, book_id: int, page_no: int) -> BookJob | None:
        row = self._conn.execute(
            "select b.user_id, b.file_key, b.title from book b "
            "join book_page p on p.book_id = b.id and p.page_no = %s "
            "where b.id = %s and b.status = 'ocr' and p.scanned "
            "and p.ocr_read_at is null",
            (page_no, book_id),
        ).fetchone()
        if row is None:
            return None
        return BookJob(book_id, str(row[0]), str(row[1]), str(row[2]))

    def record_ocr(self, book_id: int, page_no: int, text: str) -> int | None:
        # The book's lock first: two pages finishing at once take turns, so exactly
        # one of them sees none left.
        waiting = self._conn.execute(
            "select 1 from book where id = %s and status = 'ocr' for update",
            (book_id,),
        ).fetchone()
        if waiting is None:  # deleted, or built already
            return None
        updated = self._conn.execute(
            "update book_page set text = %s, ocr_read_at = now() "
            "where book_id = %s and page_no = %s and scanned "
            "and ocr_read_at is null",
            (text, book_id, page_no),
        )
        if updated.rowcount == 0:  # read by an earlier delivery
            return None
        row = self._conn.execute(
            "select count(*) from book_page "
            "where book_id = %s and scanned and ocr_read_at is null",
            (book_id,),
        ).fetchone()
        assert row is not None
        return int(row[0])

    def unread_scanned(self, book_id: int) -> list[int]:
        rows = self._conn.execute(
            "select p.page_no from book_page p join book b on b.id = p.book_id "
            "where p.book_id = %s and b.status = 'ocr' and p.scanned "
            "and p.ocr_read_at is null order by p.page_no",
            (book_id,),
        ).fetchall()
        return [int(r[0]) for r in rows]

    def pages(self, book_id: int) -> list[BookPageText]:
        rows = self._conn.execute(
            "select page_no, text, scanned from book_page "
            "where book_id = %s order by page_no",
            (book_id,),
        ).fetchall()
        return [BookPageText(int(n), str(t), bool(s)) for n, t, s in rows]

    def checkpoint_input(self, chapter_id: int) -> ChapterForCheckpoint | None:
        head = self._conn.execute(
            """
            select b.user_id, b.title, c.title from book_chapter_checkpoint k
            join book_chapter c on c.id = k.chapter_id
            join book b on b.id = c.book_id and b.status = 'ready'
            where k.chapter_id = %s and k.status = 'preparing'
            """,
            (chapter_id,),
        ).fetchone()
        if head is None:
            return None
        sessions = self._conn.execute(
            "select title, text from book_session where chapter_id = %s "
            "order by ordinal",
            (chapter_id,),
        ).fetchall()
        return ChapterForCheckpoint(
            chapter_id,
            str(head[0]),
            str(head[1]),
            str(head[2]),
            [(str(t), str(x)) for t, x in sessions],
        )

    def save_checkpoint(
        self,
        chapter_id: int,
        concepts: frozenset[str],
        questions: list[BookQuestion],
        generator_model: str,
        validator_model: str,
    ) -> Literal["ready", "empty", "gone"]:
        conn = self._conn
        # Locked: a second delivery waits, then finds it no longer preparing.
        if (
            conn.execute(
                "select 1 from book_chapter_checkpoint "
                "where chapter_id = %s and status = 'preparing' for update",
                (chapter_id,),
            ).fetchone()
            is None
        ):
            return "gone"
        # A try after a failure replaces the rejected drafts; nothing was answered.
        conn.execute(
            "delete from question where book_chapter_id = %s and status <> 'live'",
            (chapter_id,),
        )
        conn.execute(
            "delete from book_chapter_concept where chapter_id = %s", (chapter_id,)
        )
        conn.execute(
            """
            insert into book_chapter_concept (chapter_id, concept_id)
            select %s, id from concept where slug = any(%s)
            """,
            (chapter_id, sorted(concepts)),
        )
        row = conn.execute(
            "select coalesce(max(ordinal) + 1, 0) from question "
            "where book_chapter_id = %s",
            (chapter_id,),
        ).fetchone()
        first = 0 if row is None else int(row[0])
        for ordinal, question in enumerate(questions, start=first):
            draft = question.draft
            inserted = conn.execute(
                """
                insert into question (book_chapter_id, ordinal, stem, options,
                  correct, citation, generator_model, prompt_version, content_hash,
                  difficulty, status, validator_model, validator_answer, validated_at)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                  %s::question_status, %s, %s,
                  case when %s then now() end)
                returning id
                """,
                (
                    chapter_id,
                    ordinal,
                    draft.stem,
                    list(draft.options),
                    draft.correct,
                    draft.citation,
                    generator_model,
                    QUESTIONS_PROMPT_VERSION,
                    question.content_hash,
                    question.difficulty,
                    "live" if question.live else "rejected",
                    # An unreadable verdict is no verdict: rejected, unvalidated.
                    None if question.validator_answer is None else validator_model,
                    question.validator_answer,
                    question.validator_answer is not None,
                ),
            ).fetchone()
            assert inserted is not None  # insert ... returning always returns the row
            conn.execute(
                """
                insert into question_concept (question_id, concept_id)
                select %s, id from concept where slug = any(%s)
                """,
                (inserted[0], sorted(question.concepts)),
            )
        live = conn.execute(
            "select exists (select 1 from question "
            "where book_chapter_id = %s and status = 'live')",
            (chapter_id,),
        ).fetchone()
        if live is None or not live[0]:
            return "empty"
        conn.execute(
            "update book_chapter_checkpoint set status = 'ready', ready_at = now(), "
            "failure = null where chapter_id = %s",
            (chapter_id,),
        )
        return "ready"

    def fail_checkpoint(self, chapter_id: int, reason: str) -> None:
        self._conn.execute(
            "update book_chapter_checkpoint set status = 'failed', failure = %s "
            "where chapter_id = %s and status = 'preparing'",
            (reason[:200], chapter_id),
        )


class PostgresGitHub:
    """A connected user's repositories (§5H, ADR-0024, P2-W12-S02): metadata and
    dependency names only, never code."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def sync_input(self, user_id: str) -> GitHubSyncInput | None:
        account = self._conn.execute(
            "select login from github_account where user_id = %s", (user_id,)
        ).fetchone()
        if account is None:
            return None
        installations = self._conn.execute(
            "select installation_id, account_login from github_installation "
            "where user_id = %s order by installation_id",
            (user_id,),
        ).fetchall()
        reachable: dict[int, set[int]] = {}
        for installation_id, repo_id in self._conn.execute(
            "select installation_id, repo_id from github_reachable_repository "
            "where user_id = %s",
            (user_id,),
        ).fetchall():
            reachable.setdefault(int(installation_id), set()).add(int(repo_id))
        return GitHubSyncInput(
            str(account[0]),
            [(int(i), str(a)) for i, a in installations],
            {i: frozenset(r) for i, r in reachable.items()},
        )

    def save_sync(self, user_id: str, repos: list[RepoRead]) -> None:
        conn = self._conn
        # Locked: a disconnect meanwhile leaves nothing to save into.
        if (
            conn.execute(
                "select 1 from github_account where user_id = %s for update",
                (user_id,),
            ).fetchone()
            is None
        ):
            return
        # Access as it is now, under the lock: a reconnect while GitHub was read may
        # have narrowed it, and only what's still allowed is kept.
        now = self.sync_input(user_id)
        assert now is not None  # the row is locked
        repos = [r for r in repos if now.allowed(r.installation_id, r.repo.repo_id)]
        conn.execute("delete from github_repository where user_id = %s", (user_id,))
        for read in repos:
            repo = read.repo
            conn.execute(
                """
                insert into github_repository (user_id, repo_id, installation_id,
                  full_name, description, languages, default_branch, pushed_at)
                values (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    user_id,
                    repo.repo_id,
                    read.installation_id,
                    repo.full_name[:200],
                    None if repo.description is None else repo.description[:500],
                    read.languages[:5],
                    repo.default_branch,
                    repo.pushed_at,
                ),
            )
            with conn.cursor() as cur:
                cur.executemany(
                    """
                    insert into github_dependency
                      (user_id, repo_id, ecosystem, name, path, dev)
                    values (%s, %s, %s::dependency_ecosystem, %s, %s, %s)
                    on conflict (user_id, repo_id, ecosystem, name) do update
                      set dev = github_dependency.dev and excluded.dev
                    """,
                    [
                        (
                            user_id,
                            repo.repo_id,
                            d.ecosystem,
                            d.name[:214],
                            d.path,
                            d.dev,
                        )
                        for d in read.dependencies
                    ],
                )
        conn.execute(
            "update github_account set synced_at = now() where user_id = %s", (user_id,)
        )

    def due_for_sync(self, active_days: int) -> list[str]:
        rows = self._conn.execute(
            """
            select a.user_id from github_account a
            where exists (
              select 1 from auth_session s
              where s.user_id = a.user_id
                and s.updated_at >= now() - make_interval(days => %s)
            )
            order by a.user_id
            """,
            (active_days,),
        ).fetchall()
        return [str(r[0]) for r in rows]


class PostgresTechnologies:
    """The curated technology table (PER-4, P2-W12-S03)."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def sync_seed(self, technologies: list[TechnologySeed]) -> TechnologiesSynced:
        conn = self._conn
        # One loader at a time: two at once would race on the same slugs.
        conn.execute("select pg_advisory_xact_lock(hashtext('technology-seed'))")
        existing = {
            str(slug)
            for (slug,) in conn.execute("select slug from technology").fetchall()
        }
        added = updated = 0
        for tech in technologies:
            row = conn.execute(
                """
                insert into technology (slug, name, source)
                values (%s, %s, 'seed')
                on conflict (slug) do update
                  set name = excluded.name, retired_at = null
                returning id
                """,
                (tech.slug, tech.name),
            ).fetchone()
            assert row is not None  # insert ... returning always returns the row
            technology_id = int(row[0])
            if tech.slug in existing:
                updated += 1
            else:
                added += 1
            # Only the seed's own: an accepted suggestion on this technology stays.
            conn.execute(
                "delete from technology_package "
                "where technology_id = %s and origin = 'seed'",
                (technology_id,),
            )
            conn.execute(
                "delete from technology_concept "
                "where technology_id = %s and origin = 'seed'",
                (technology_id,),
            )
            with conn.cursor() as cur:
                cur.executemany(
                    "insert into technology_package "
                    "(ecosystem, pattern, prefix, technology_id, origin) "
                    "values (%s::dependency_ecosystem, %s, %s, %s, 'seed') "
                    # A pattern another seed technology held moves to this one; one
                    # an accepted suggestion holds stays with it.
                    "on conflict (ecosystem, pattern, prefix) do update "
                    "set technology_id = excluded.technology_id "
                    "where technology_package.origin = 'seed'",
                    [
                        (p.ecosystem, p.pattern, p.prefix, technology_id)
                        for p in tech.packages
                    ],
                )
            conn.execute(
                """
                insert into technology_concept (technology_id, concept_id, origin)
                select %s, id, 'seed' from concept where slug = any(%s)
                on conflict (technology_id, concept_id) do nothing
                """,
                (technology_id, list(tech.concepts)),
            )
        retired = conn.execute(
            """
            update technology set retired_at = now()
            where source = 'seed' and retired_at is null and not (slug = any(%s))
            """,
            ([t.slug for t in technologies],),
        ).rowcount
        return TechnologiesSynced(added, updated, retired)

    def unclaimed(self, min_users: int, limit: int) -> list[Unclaimed]:
        rows = self._conn.execute(
            """
            select ecosystem, package, users from unclaimed_dependency
            where not asked and users >= %s
            order by users desc, ecosystem, package
            limit %s
            """,
            (min_users, limit),
        ).fetchall()
        return [Unclaimed(str(e), str(n), int(u)) for e, n, u in rows]

    def save_suggestion(self, suggestion: TechnologySuggestion) -> None:
        self._conn.execute(
            """
            insert into technology_suggestion
              (ecosystem, package, users, name, slug, concepts, model, status)
            values (%s::dependency_ecosystem, %s, %s, %s, %s, %s, %s,
                    %s::suggestion_status)
            on conflict (ecosystem, package) do nothing
            """,
            (
                suggestion.ecosystem,
                suggestion.package,
                suggestion.users,
                suggestion.name,
                suggestion.slug,
                list(suggestion.concepts),
                suggestion.model,
                "unreadable"
                if suggestion.unreadable
                else "skipped"
                if suggestion.slug is None
                else "pending",
            ),
        )


class PostgresStore:
    def __init__(self, conn: psycopg.Connection) -> None:
        self.paths = PostgresPaths(conn)
        self.books = PostgresBooks(conn)
        self.github = PostgresGitHub(conn)
        self.technologies = PostgresTechnologies(conn)
        self.sources = PostgresSources(conn)
        self.items = PostgresItems(conn)
        self.moments = PostgresMoments(conn)
        self.feed = PostgresFeed(conn)
        self.notes = PostgresNotes(conn)
        self.invites = PostgresInvites(conn)
        self.users = PostgresUsers(conn)
        self.grants = PostgresGrants(conn)
        self.validators = PostgresValidators(conn)
        self.concepts = PostgresConcepts(conn)
        self.tags = PostgresItemTags(conn)
        self.embeddings = PostgresEmbeddings(conn)
        self.ranking = PostgresRankingInputs(conn)
        self.decisions = PostgresDecisions(conn)
        self.questions = PostgresQuestions(conn)


@contextmanager
def unit_of_work(database_url: str) -> Generator[PostgresStore]:
    # An explicit outer transaction: commits on success, rolls back on any exception
    # (including SystemExit), and makes every guarded write below a nested savepoint.
    with psycopg.connect(database_url) as conn, conn.transaction():
        yield PostgresStore(conn)
