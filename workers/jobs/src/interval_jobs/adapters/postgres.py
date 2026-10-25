"""Postgres adapter (ADR-0012): the repositories behind `Store`, over one connection.

One `PostgresStore` is one unit of work; `unit_of_work` commits it on success and rolls
it back on error. The database's own triggers still guard ING-2 behind these queries.
"""

from collections.abc import Generator
from contextlib import contextmanager
from datetime import datetime

import psycopg
from psycopg.rows import class_row

from interval_db.generated import BetaGroup, Capability, RightsProfile
from interval_jobs.ports import (
    DuplicateInviteCode,
    FeedEntry,
    GrantResult,
    MomentRow,
    RevokeResult,
    RightsViolation,
    Section,
    SectionRow,
    SegmentationInput,
    SourceRecord,
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


class PostgresSources:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def get(self, source_id: int) -> SourceRecord | None:
        with self._conn.cursor(row_factory=class_row(SourceRecord)) as cur:
            return cur.execute(
                "select id, feed_url, rights_profile from source where id = %s",
                (source_id,),
            ).fetchone()

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
                  homepage = excluded.homepage
            returning id
            """,
            (name, feed_url, rights_profile, homepage),
        ).fetchone()
        if row is None:
            raise RuntimeError("upsert returned no row")
        source_id: int = row[0]
        return source_id


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
              set canonical_url = excluded.canonical_url,
                  title = excluded.title,
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
                "select heading, anchor_id, word_count from content_item_section "
                "where content_item_id = %s order by ordinal",
                (item_id,),
            ).fetchall()


class PostgresMoments:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def replace(self, item_id: int, rows: list[MomentRow]) -> None:
        with _rights_guard(self._conn):
            with self._conn.cursor() as cur:
                cur.executemany(
                    """
                    insert into moment
                      (content_item_id, ordinal, title, estimated_minutes,
                       link, link_type)
                    values (%s, %s, %s, %s, %s, %s)
                    on conflict (content_item_id, ordinal) do update
                      set title = excluded.title,
                          estimated_minutes = excluded.estimated_minutes,
                          link = excluded.link,
                          link_type = excluded.link_type
                    """,
                    [
                        (
                            item_id,
                            r.ordinal,
                            r.title,
                            r.estimated_minutes,
                            r.link,
                            r.link_type,
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


class PostgresStore:
    def __init__(self, conn: psycopg.Connection) -> None:
        self.sources = PostgresSources(conn)
        self.items = PostgresItems(conn)
        self.moments = PostgresMoments(conn)
        self.feed = PostgresFeed(conn)
        self.invites = PostgresInvites(conn)
        self.users = PostgresUsers(conn)
        self.grants = PostgresGrants(conn)


@contextmanager
def unit_of_work(database_url: str) -> Generator[PostgresStore]:
    # An explicit outer transaction: commits on success, rolls back on any exception
    # (including SystemExit), and makes every guarded write below a nested savepoint.
    with psycopg.connect(database_url) as conn, conn.transaction():
        yield PostgresStore(conn)
