"""Postgres adapter (ADR-0012): the repositories behind `Store`, over one connection.

One `PostgresStore` is one unit of work; `unit_of_work` commits it on success and rolls
it back on error. The database's own triggers still guard ING-2 behind these queries.
"""

from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal

import psycopg
from psycopg.rows import class_row

from interval_db.generated import BetaGroup, Capability, RightsProfile
from interval_jobs.normalize import MAX_SIMHASH_DISTANCE
from interval_jobs.ports import (
    VALIDATORS_MAX_AGE,
    ConceptCycleError,
    ConceptEdge,
    ConceptGraph,
    ConceptSeed,
    DuplicateInviteCode,
    FeedEntry,
    FetchInput,
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
    TagInput,
    TagMoment,
    TagResult,
    Tags,
    Usage,
    Validators,
)


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


# Serialises feed rebuilds: two concurrent delete+insert runs would collide on the
# primary key (LOAD-5: jobs may run more than once and side by side).
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
                    f"insert into source (name, {_SETTINGS_WRITE}) "
                    "values (%s, %s, %s, %s, %s, %s, %s, %s)",
                    (seed.name, *values),
                )
                added += 1
                continue
            current = (row[1], *row[2:8], list(row[8]))
            if row[9] and current == (seed.name, *values):
                unchanged += 1
                continue
            # One update, so the purge triggers see profile and switch together.
            self._conn.execute(
                f"update source set (name, {_SETTINGS_WRITE}, active) = "
                "(%s, %s, %s, %s, %s, %s, %s, %s, true) where id = %s",
                (seed.name, *values, row[0]),
            )
            updated += 1
        deactivated = self._conn.execute(
            "update source set active = false where active and name <> all(%s)",
            ([seed.name for seed in seeds],),
        ).rowcount
        return SyncResult(added, updated, unchanged, deactivated)


_SETTINGS_WRITE = (
    "feed_url, rights_profile, homepage, moments_enabled, paywalled, "
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


class PostgresFeed:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def rebuild(self) -> int:
        # Placeholder order until ranking (REC-1, REC-2) in Week 4: newest item first,
        # then its sections in reading order.
        self._conn.execute("select pg_advisory_xact_lock(%s)", (FEED_LOCK_KEY,))
        self._conn.execute("delete from feed_entry")
        cursor = self._conn.execute(
            """
            insert into feed_entry (moment_id, rank)
            select m.id,
                   row_number() over (
                     order by ci.published_at desc nulls last, ci.id desc, m.ordinal
                   )
            from moment m
            join content_item ci on ci.id = m.content_item_id
            where ci.id in (
              -- Per duplicate group, the earliest copy that has moments: the primary
              -- may be a metadata-only listing with none (owner review, 2026-10-26).
              select distinct on (coalesce(c.duplicate_of, c.id)) c.id
              from content_item c
              where exists (select 1 from moment x where x.content_item_id = c.id)
              order by coalesce(c.duplicate_of, c.id), c.published_at nulls last, c.id
            )
            """
        )
        return cursor.rowcount


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

    def spent_usd(self, user_id: str | None, day: date) -> Decimal:
        start = datetime.combine(day, time(), tzinfo=UTC)
        end = start + timedelta(days=1)
        # Two queries, so each one matches its own index (ai_usage_user_day and
        # ai_usage_offline_day).
        if user_id is None:
            row = self._conn.execute(
                "select coalesce(sum(cost_usd), 0) from ai_usage "
                "where is_offline and occurred_at >= %s and occurred_at < %s",
                (start, end),
            ).fetchone()
        else:
            row = self._conn.execute(
                "select coalesce(sum(cost_usd), 0) from ai_usage "
                "where user_id = %s and occurred_at >= %s and occurred_at < %s",
                (user_id, start, end),
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
            ConceptSeed(slug, name, topic, description, retired, merged_into)
            for (
                slug,
                name,
                topic,
                description,
                retired,
                merged_into,
            ) in self._conn.execute(
                """
                select c.slug, c.name, c.topic, c.description, c.retired_at is not null,
                       m.slug
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
                insert into concept (slug, name, topic, description, retired_at)
                values (%(slug)s, %(name)s, %(topic)s, %(description)s,
                        case when %(retired)s then now() end)
                on conflict (slug) do update
                  set name = excluded.name,
                      topic = excluded.topic,
                      description = excluded.description,
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

    def get(self, slug: str) -> ConceptSeed | None:
        row = self._conn.execute(
            """
            select c.slug, c.name, c.topic, c.description, c.retired_at is not null,
                   m.slug
            from concept c left join concept m on m.id = c.merged_into
            where c.slug = %s
            """,
            (slug,),
        ).fetchone()
        return None if row is None else ConceptSeed(*row)

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


class PostgresStore:
    def __init__(self, conn: psycopg.Connection) -> None:
        self.sources = PostgresSources(conn)
        self.items = PostgresItems(conn)
        self.moments = PostgresMoments(conn)
        self.feed = PostgresFeed(conn)
        self.invites = PostgresInvites(conn)
        self.users = PostgresUsers(conn)
        self.grants = PostgresGrants(conn)
        self.validators = PostgresValidators(conn)
        self.concepts = PostgresConcepts(conn)
        self.tags = PostgresItemTags(conn)


@contextmanager
def unit_of_work(database_url: str) -> Generator[PostgresStore]:
    # An explicit outer transaction: commits on success, rolls back on any exception
    # (including SystemExit), and makes every guarded write below a nested savepoint.
    with psycopg.connect(database_url) as conn, conn.transaction():
        yield PostgresStore(conn)
