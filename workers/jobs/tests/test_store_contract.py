"""Store contract (ADR-0012): the same repository cases against the in-memory fake and
the Postgres adapter, so logic tested on the fake behaves the same on the database.

Ports have no read methods that only tests need; each store gets a test-side probe that
inspects its state (internal fields for the fake, SQL for Postgres).
"""

from collections.abc import Iterator
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Protocol, get_args
from uuid import uuid4

import psycopg
import pytest

from interval_db.generated import RightsProfile, Topic
from interval_jobs.adapters.memory import (
    RANKING_DEFAULTS,
    InMemoryAi,
    InMemoryStore,
    StoredUser,
)
from interval_jobs.adapters.postgres import PostgresAi, PostgresStore
from interval_jobs.concepts.graph import ConceptSeedError, parse_concepts
from interval_jobs.concepts.sync import sync_concepts
from interval_jobs.ports import (
    AiLedger,
    ConceptCycleError,
    ConceptEdge,
    ConceptGraph,
    DuplicateInviteCode,
    FeedEntry,
    MomentRow,
    RightsViolation,
    Section,
    SectionRow,
    SourceSettings,
    Store,
    TagResult,
    Tags,
    Usage,
    UserPreferences,
    Validators,
)


def email_of(user_id: str) -> str:
    return f"{user_id}@contract.example.test"


class Probe(Protocol):
    def enable_moments(self, source_id: int) -> None: ...
    def excerpt(self, item_id: int) -> str | None: ...
    def full_text(self, item_id: int) -> str | None: ...
    def moments(self, item_id: int) -> list[tuple[int, int, str]]: ...
    def feed_titles(self) -> list[str]: ...
    def disable_moments(self, source_id: int) -> None: ...
    def invite(
        self, code: str
    ) -> tuple[str, int, int, datetime, str | None] | None: ...
    def add_user(
        self, user_id: str, anonymous: bool, session_expires: list[datetime]
    ) -> None: ...
    def user_ids(self) -> set[str]: ...
    def capabilities(self, user_id: str) -> set[str]: ...
    def delete_user(self, user_id: str) -> None: ...
    def source_state(self, name: str) -> tuple[object, ...] | None: ...
    def has_item(self, item_id: int) -> bool: ...
    def primary_of(self, item_id: int) -> int | None: ...
    def oversized(self, item_id: int) -> list[bool]: ...
    def reset_concepts(self) -> None: ...
    def set_boundaries(self, item_id: int, headings: list[str]) -> None: ...
    def switch_moments_off(self, source_id: int, off: bool) -> None: ...
    # What the web app writes about a user (P1-W4-S01, W4-S07).
    def set_preferences(self, user_id: str, topics: list[str]) -> None: ...
    def give_feedback(self, user_id: str, item_id: int, kind: str) -> None: ...
    def hide_source(self, user_id: str, source_id: int) -> None: ...
    def correct_concepts(self, item_id: int, slugs: list[str]) -> None: ...
    def override_level(self, item_id: int, heading: str, level: str) -> None: ...
    def simhash(self, item_id: int) -> int | None: ...


@dataclass
class MemoryProbe:
    s: InMemoryStore

    def enable_moments(self, source_id: int) -> None:
        self.s.sources.set_moments_enabled(source_id, True)

    def disable_moments(self, source_id: int) -> None:
        self.s.sources.set_moments_enabled(source_id, False)

    def add_user(
        self, user_id: str, anonymous: bool, session_expires: list[datetime]
    ) -> None:
        self.s.users.rows[user_id] = StoredUser(
            user_id, anonymous, list(session_expires), email=email_of(user_id)
        )

    def user_ids(self) -> set[str]:
        return set(self.s.users.rows)

    def capabilities(self, user_id: str) -> set[str]:
        return set(self.s.users.rows[user_id].capabilities)

    def delete_user(self, user_id: str) -> None:
        del self.s.users.rows[user_id]

    def source_state(self, name: str) -> tuple[object, ...] | None:
        row = next((r for r in self.s.sources.rows.values() if r.name == name), None)
        if row is None:
            return None
        return (
            row.active,
            row.feed_url,
            row.rights_profile,
            row.moments_enabled,
            row.paywalled,
            row.quality_score,
            tuple(row.topics),
        )

    def has_item(self, item_id: int) -> bool:
        return item_id in self.s.items.rows

    def primary_of(self, item_id: int) -> int | None:
        return self.s.items.rows[item_id].duplicate_of

    def oversized(self, item_id: int) -> list[bool]:
        return [m.row.oversized for m in self.s.moments.for_item(item_id)]

    def reset_concepts(self) -> None:
        pass  # a fresh store has no graph

    def set_boundaries(self, item_id: int, headings: list[str]) -> None:
        self.s.items.boundary_overrides[item_id] = headings

    def switch_moments_off(self, source_id: int, off: bool) -> None:
        self.s.sources.switch_moments_off(source_id, off)

    def set_preferences(self, user_id: str, topics: list[str]) -> None:
        self.s.ranking.preferences_by_user[user_id] = UserPreferences(
            [t for t in get_args(Topic.__value__) if t in topics], "beginner", "3-8"
        )

    def give_feedback(self, user_id: str, item_id: int, kind: str) -> None:
        self.s.ranking.feedback.append((user_id, item_id, kind))

    def hide_source(self, user_id: str, source_id: int) -> None:
        self.s.ranking.hidden.add((user_id, source_id))

    def correct_concepts(self, item_id: int, slugs: list[str]) -> None:
        self.s.tags.item_concept_overrides[item_id] = frozenset(slugs)

    def override_level(self, item_id: int, heading: str, level: str) -> None:
        assert level in ("beginner", "intermediate", "advanced")
        self.s.tags.overrides[(item_id, heading)] = level

    def simhash(self, item_id: int) -> int | None:
        return self.s.items.rows[item_id].simhash

    def invite(self, code: str) -> tuple[str, int, int, datetime, str | None] | None:
        row = self.s.invites.rows.get(code)
        if row is None:
            return None
        return (row.beta_group, row.max_uses, row.used_count, row.expires_at, row.note)

    def excerpt(self, item_id: int) -> str | None:
        return self.s.items.rows[item_id].excerpt

    def full_text(self, item_id: int) -> str | None:
        return self.s.items.rows[item_id].full_text

    def moments(self, item_id: int) -> list[tuple[int, int, str]]:
        return [
            (m.id, m.row.ordinal, m.row.title) for m in self.s.moments.for_item(item_id)
        ]

    def feed_titles(self) -> list[str]:
        by_id = {m.id: m.row.title for m in self.s.moments.rows}
        return [by_id[i] for i in self.s.feed.entries]


@dataclass
class PostgresProbe:
    conn: psycopg.Connection

    def enable_moments(self, source_id: int) -> None:
        self.conn.execute(
            "update source set moments_seeded = true, moments_enabled = true "
            "where id = %s",
            (source_id,),
        )

    def disable_moments(self, source_id: int) -> None:
        self.conn.execute(
            "update source set moments_seeded = false, moments_enabled = false "
            "where id = %s",
            (source_id,),
        )

    def add_user(
        self, user_id: str, anonymous: bool, session_expires: list[datetime]
    ) -> None:
        code = self.conn.execute(
            "insert into invite_code (code, beta_group, max_uses, expires_at) "
            "values (%s, 'student', 10, now() + interval '1 day') "
            "on conflict (code) do update set max_uses = 10 returning id",
            ("CONTRACTUSERS",),
        ).fetchone()
        assert code is not None
        self.conn.execute(
            "insert into app_user "
            "(id, name, email, is_anonymous, beta_group, invite_code_id) "
            "values (%s, 'n', %s, %s, 'student', %s)",
            (user_id, email_of(user_id), anonymous, code[0]),
        )
        for i, expires in enumerate(session_expires):
            self.conn.execute(
                "insert into auth_session (id, expires_at, token, updated_at, user_id) "
                "values (%s, %s, %s, now(), %s)",
                (f"{user_id}-s{i}", expires, f"{user_id}-t{i}", user_id),
            )

    def delete_user(self, user_id: str) -> None:
        self.conn.execute("delete from app_user where id = %s", (user_id,))

    def source_state(self, name: str) -> tuple[object, ...] | None:
        row = self.conn.execute(
            "select active, feed_url, rights_profile::text, moments_enabled, "
            "paywalled, quality_score, topics from source where name = %s",
            (name,),
        ).fetchone()
        return None if row is None else (*row[:6], tuple(row[6]))

    def has_item(self, item_id: int) -> bool:
        row = self.conn.execute(
            "select 1 from content_item where id = %s", (item_id,)
        ).fetchone()
        return row is not None

    def capabilities(self, user_id: str) -> set[str]:
        rows = self.conn.execute(
            "select capability::text from user_capability where user_id = %s",
            (user_id,),
        ).fetchall()
        return {r[0] for r in rows}

    def user_ids(self) -> set[str]:
        rows = self.conn.execute(
            "select id from app_user where email like '%%@contract.example.test'"
        ).fetchall()
        return {r[0] for r in rows}

    def invite(self, code: str) -> tuple[str, int, int, datetime, str | None] | None:
        row = self.conn.execute(
            "select beta_group::text, max_uses, used_count, expires_at, note "
            "from invite_code where code = %s",
            (code,),
        ).fetchone()
        return None if row is None else (row[0], row[1], row[2], row[3], row[4])

    def excerpt(self, item_id: int) -> str | None:
        row = self.conn.execute(
            "select excerpt from content_item where id = %s", (item_id,)
        ).fetchone()
        assert row is not None
        value: str | None = row[0]
        return value

    def full_text(self, item_id: int) -> str | None:
        row = self.conn.execute(
            "select text from content_item_private_text where content_item_id = %s",
            (item_id,),
        ).fetchone()
        return None if row is None else str(row[0])

    def moments(self, item_id: int) -> list[tuple[int, int, str]]:
        return self.conn.execute(
            "select id, ordinal, title from moment where content_item_id = %s "
            "order by ordinal",
            (item_id,),
        ).fetchall()

    def override_level(self, item_id: int, heading: str, level: str) -> None:
        self.conn.execute(
            "insert into tag_override (content_item_id, heading, difficulty, "
            "concepts, updated_by) values (%s, %s, %s, '{}', 'contract-test')",
            (item_id, heading, level),
        )

    def set_preferences(self, user_id: str, topics: list[str]) -> None:
        self.conn.execute(
            "insert into user_preferences (user_id, topics, level, break_length) "
            "values (%s, %s::topic[], 'beginner', '3-8')",
            (user_id, topics),
        )

    def give_feedback(self, user_id: str, item_id: int, kind: str) -> None:
        self.conn.execute(
            "insert into item_feedback (user_id, content_item_id, kind) "
            "values (%s, %s, %s)",
            (user_id, item_id, kind),
        )

    def hide_source(self, user_id: str, source_id: int) -> None:
        self.conn.execute(
            "insert into user_hidden_source (user_id, source_id) values (%s, %s)",
            (user_id, source_id),
        )

    def correct_concepts(self, item_id: int, slugs: list[str]) -> None:
        self.conn.execute(
            "insert into tag_override (content_item_id, heading, difficulty, concepts, "
            "updated_by) values (%s, '', 'beginner', %s, 'contract-test')",
            (item_id, slugs),
        )

    def switch_moments_off(self, source_id: int, off: bool) -> None:
        # What the web admin page runs (P1-W3-S06).
        self.conn.execute(
            "update source set moments_switched_off = %s, "
            "moments_enabled = moments_seeded and not %s where id = %s",
            (off, off, source_id),
        )

    def set_boundaries(self, item_id: int, headings: list[str]) -> None:
        # The web admin page writes these (P1-W3-S05).
        self.conn.execute(
            "insert into moment_boundary_override (content_item_id, headings, "
            "updated_by) values (%s, %s, 'contract-test')",
            (item_id, headings),
        )

    def reset_concepts(self) -> None:
        # A local database may hold the real graph; the test's transaction rolls this
        # back. Truncate skips the never-deleted row trigger.
        self.conn.execute("truncate concept_edge, graph_version, concept cascade")

    def oversized(self, item_id: int) -> list[bool]:
        rows = self.conn.execute(
            "select oversized from moment where content_item_id = %s order by ordinal",
            (item_id,),
        ).fetchall()
        return [bool(r[0]) for r in rows]

    def primary_of(self, item_id: int) -> int | None:
        row = self.conn.execute(
            "select duplicate_of from content_item where id = %s", (item_id,)
        ).fetchone()
        assert row is not None
        return row[0]

    def simhash(self, item_id: int) -> int | None:
        row = self.conn.execute(
            "select simhash from content_item where id = %s", (item_id,)
        ).fetchone()
        assert row is not None
        return row[0]

    def feed_titles(self) -> list[str]:
        rows = self.conn.execute(
            "select m.title from feed_entry fe join moment m on m.id = fe.moment_id "
            "join content_item ci on ci.id = m.content_item_id "
            "where ci.guid like 'contract-%%' order by fe.rank"
        ).fetchall()
        return [r[0] for r in rows]


@pytest.fixture(params=["memory", "postgres"])
def store(request: pytest.FixtureRequest) -> Iterator[tuple[Store, Probe]]:
    if request.param == "memory":
        memory = InMemoryStore()
        yield memory, MemoryProbe(memory)
        return
    conn: psycopg.Connection = request.getfixturevalue("conn")
    yield PostgresStore(conn), PostgresProbe(conn)


# The AI ledger isn't part of the Store: it commits on its own connection (OPS-4).
@pytest.fixture(params=["memory", "postgres"])
def ledger(request: pytest.FixtureRequest) -> Iterator[tuple[AiLedger, Probe]]:
    if request.param == "memory":
        memory = InMemoryStore()
        yield InMemoryAi(memory.users), MemoryProbe(memory)
        return
    conn: psycopg.Connection = request.getfixturevalue("conn")
    yield PostgresAi(conn), PostgresProbe(conn)


def entry(guid: str, published: datetime | None = None, title: str = "T") -> FeedEntry:
    return FeedEntry(
        guid=f"contract-{guid}",
        link=f"https://contract.example.test/{guid}",
        title=title,
        author=None,
        published_at=published,
        updated_at=None,
        summary="s",
    )


def source(s: Store, profile: RightsProfile = "full_text_internal") -> int:
    return s.sources.upsert(
        name=f"contract-{profile}",
        feed_url=f"https://contract.example.test/{profile}.xml",
        rights_profile=profile,
        homepage=None,
    )


def moment(ordinal: int, title: str) -> MomentRow:
    return MomentRow(ordinal, title, 1, "https://contract.example.test/a", "page_top")


def test_source_upsert_is_idempotent_by_name_and_get_reads_it_back(
    store: tuple[Store, Probe],
) -> None:
    s, _ = store
    first = source(s, "excerpt")
    again = s.sources.upsert(
        name="contract-excerpt",
        feed_url="https://contract.example.test/moved.xml",
        rights_profile="excerpt",
        homepage=None,
    )
    record = s.sources.get(first)
    assert again == first
    assert record is not None
    assert (record.feed_url, record.rights_profile) == (
        "https://contract.example.test/moved.xml",
        "excerpt",
    )
    assert s.sources.get(10**12) is None


def test_item_upsert_by_guid_keeps_or_drops_the_excerpt(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    sid = source(s, "excerpt")
    item = s.items.upsert_from_feed(sid, entry("g1"), keep_excerpt=True)
    s.items.set_excerpt(item, "an excerpt")
    assert (
        s.items.upsert_from_feed(sid, entry("g1", title="T2"), keep_excerpt=True)
        == item
    )
    assert probe.excerpt(item) == "an excerpt"
    s.items.upsert_from_feed(sid, entry("g1"), keep_excerpt=False)
    assert probe.excerpt(item) is None


def test_full_text_store_replace_and_drop(store: tuple[Store, Probe]) -> None:
    s, probe = store
    item = s.items.upsert_from_feed(source(s), entry("g2"), keep_excerpt=False)
    s.items.store_full_text(item, "first")
    s.items.store_full_text(item, "second")
    assert probe.full_text(item) == "second"
    s.items.drop_full_text(item)
    assert probe.full_text(item) is None


def test_sections_are_replaced_and_read_in_order(store: tuple[Store, Probe]) -> None:
    s, _ = store
    item = s.items.upsert_from_feed(source(s), entry("g3"), keep_excerpt=False)
    s.items.replace_sections(
        item, [Section("A", 2, "a", 10), Section(None, None, None, 5)]
    )
    s.items.replace_sections(item, [Section("B", 2, None, 7), Section("C", 3, "c", 9)])
    assert s.items.sections(item) == [
        SectionRow("B", None, 7, 2),
        SectionRow("C", "c", 9, 3),
    ]


def test_segmentation_input_reflects_the_source(store: tuple[Store, Probe]) -> None:
    s, probe = store
    sid = source(s)
    item = s.items.upsert_from_feed(sid, entry("g4", title="Title"), keep_excerpt=False)
    probe.enable_moments(sid)
    got = s.items.for_segmentation(item)
    assert got is not None
    assert (got.title, got.canonical_url, got.rights_profile, got.moments_enabled) == (
        "Title",
        "https://contract.example.test/g4",
        "full_text_internal",
        True,
    )
    assert s.items.for_segmentation(10**12) is None


def test_moments_replace_keeps_ids_by_ordinal_and_removes_extras(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    sid = source(s)
    probe.enable_moments(sid)
    item = s.items.upsert_from_feed(sid, entry("g5"), keep_excerpt=False)
    s.moments.replace(item, [moment(0, "a"), moment(1, "b"), moment(2, "c")])
    ids = [m[0] for m in probe.moments(item)]
    s.moments.replace(item, [moment(0, "a2"), moment(1, "b2")])
    assert probe.moments(item) == [(ids[0], 0, "a2"), (ids[1], 1, "b2")]


def test_the_oversized_flag_is_stored_and_updated(store: tuple[Store, Probe]) -> None:
    s, probe = store
    sid = source(s)
    probe.enable_moments(sid)
    item = s.items.upsert_from_feed(sid, entry("g6"), keep_excerpt=False)
    big = replace(moment(0, "big"), oversized=True)
    s.moments.replace(item, [big, moment(1, "small")])
    assert probe.oversized(item) == [True, False]
    s.moments.replace(
        item, [moment(0, "big"), replace(moment(1, "small"), oversized=True)]
    )
    assert probe.oversized(item) == [False, True]


def test_feed_orders_newest_item_first_then_sections_and_rebuild_replaces(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    sid = source(s)
    probe.enable_moments(sid)
    # Far-future dates keep these first in Postgres even if other rows exist.
    old = s.items.upsert_from_feed(
        sid, entry("old", datetime(2099, 10, 1, tzinfo=UTC)), keep_excerpt=False
    )
    new = s.items.upsert_from_feed(
        sid, entry("new", datetime(2099, 10, 20, tzinfo=UTC)), keep_excerpt=False
    )
    s.moments.replace(old, [moment(0, "old0"), moment(1, "old1")])
    s.moments.replace(new, [moment(0, "new0"), moment(1, "new1")])
    undated = s.items.upsert_from_feed(sid, entry("undated"), keep_excerpt=False)
    tie_a = s.items.upsert_from_feed(
        sid, entry("tie-a", datetime(2099, 10, 10, tzinfo=UTC)), keep_excerpt=False
    )
    tie_b = s.items.upsert_from_feed(
        sid, entry("tie-b", datetime(2099, 10, 10, tzinfo=UTC)), keep_excerpt=False
    )
    s.moments.replace(undated, [moment(0, "undated0")])
    s.moments.replace(tie_a, [moment(0, "tieA")])
    s.moments.replace(tie_b, [moment(0, "tieB")])
    s.feed.rebuild()
    s.feed.rebuild()
    titles = probe.feed_titles()
    # Newest first; equal dates by newer item (higher id) first; undated last.
    assert titles[:6] == ["new0", "new1", "tieB", "tieA", "old0", "old1"]
    assert titles[-1] == "undated0"


def change_profile(s: Store, profile_from: RightsProfile, to: RightsProfile) -> None:
    s.sources.upsert(
        name=f"contract-{profile_from}",
        feed_url=f"https://contract.example.test/{profile_from}.xml",
        rights_profile=to,
        homepage=None,
    )


def test_lowering_full_text_purges_text_sections_moments_and_feed(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    sid = source(s)
    probe.enable_moments(sid)
    item = s.items.upsert_from_feed(
        sid, entry("purge", datetime(2099, 12, 1, tzinfo=UTC)), keep_excerpt=False
    )
    s.items.store_full_text(item, "body")
    s.items.replace_sections(item, [Section("A", 2, "a", 10)])
    s.moments.replace(item, [moment(0, "purge0")])
    s.feed.rebuild()

    change_profile(s, "full_text_internal", "excerpt")
    assert probe.full_text(item) is None
    assert s.items.sections(item) == []
    assert probe.moments(item) == []
    assert "purge0" not in probe.feed_titles()


def test_lowering_excerpt_purges_the_excerpt(store: tuple[Store, Probe]) -> None:
    s, probe = store
    sid = source(s, "excerpt")
    item = s.items.upsert_from_feed(sid, entry("ex"), keep_excerpt=True)
    s.items.set_excerpt(item, "e")
    change_profile(s, "excerpt", "metadata_only")
    assert probe.excerpt(item) is None


def test_switching_moments_off_purges_moments(store: tuple[Store, Probe]) -> None:
    s, probe = store
    sid = source(s)
    probe.enable_moments(sid)
    item = s.items.upsert_from_feed(sid, entry("off"), keep_excerpt=False)
    s.moments.replace(item, [moment(0, "off0")])
    probe.disable_moments(sid)
    assert probe.moments(item) == []


def test_writes_the_profile_forbids_are_refused(store: tuple[Store, Probe]) -> None:
    s, _ = store
    meta = s.items.upsert_from_feed(source(s, "metadata_only"), entry("m"), False)
    full = s.items.upsert_from_feed(source(s), entry("f"), False)
    for write in (
        lambda: s.items.store_full_text(meta, "x"),
        lambda: s.items.replace_sections(meta, [Section("A", 2, None, 1)]),
        lambda: s.items.set_excerpt(full, "x"),
        lambda: s.moments.replace(full, [moment(0, "no switch")]),
    ):
        with pytest.raises(RightsViolation):
            write()


def test_issued_invites_are_stored_normalised_with_their_settings(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    expires = datetime(2099, 1, 1, tzinfo=UTC)
    s.invites.issue(
        beta_group="developer",
        max_uses=3,
        expires_at=expires,
        note="contract",
        codes=["contract-ab cd"],
    )
    assert probe.invite("CONTRACTABCD") == ("developer", 3, 0, expires, "contract")


def test_issuing_a_duplicate_code_is_refused(store: tuple[Store, Probe]) -> None:
    s, _ = store
    expires = datetime(2099, 1, 1, tzinfo=UTC)
    s.invites.issue(
        beta_group="student",
        max_uses=1,
        expires_at=expires,
        note=None,
        codes=["DUPCODE123"],
    )
    with pytest.raises(DuplicateInviteCode):
        s.invites.issue(
            beta_group="student",
            max_uses=1,
            expires_at=expires,
            note=None,
            codes=["dupcode123"],
        )


def test_purge_removes_only_guests_without_a_live_session(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    # A past `now`: every real guest in a shared database has a session expiring after
    # it, so the purge neither counts nor locks rows other tests are using.
    now = datetime(2000, 6, 1, tzinfo=UTC)
    probe.add_user("guest-stale", True, [datetime(2000, 5, 1, tzinfo=UTC)])
    probe.add_user("guest-none", True, [])
    probe.add_user(
        "guest-live",
        True,
        [datetime(2000, 5, 1, tzinfo=UTC), datetime(2000, 6, 2, tzinfo=UTC)],
    )
    probe.add_user("account-stale", False, [datetime(2000, 5, 1, tzinfo=UTC)])
    purged = s.users.purge_inactive_guests(now)
    assert probe.user_ids() == {"guest-live", "account-stale"}
    # A shared database can hold other session-less guests (a signed-out local one, or
    # one another test is creating), so only the fake can promise the exact count.
    assert purged == 2 if isinstance(s, InMemoryStore) else purged >= 2


# Q-P1-29: admin is granted per person, by email, to accounts only.
def test_capabilities_are_granted_and_revoked_by_email(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.add_user("acct-grant", False, [])
    probe.add_user("guest-grant", True, [])
    account = email_of("acct-grant")
    assert s.grants.grant(account, "admin.review") == "granted"
    # Granting twice is fine, and emails match whatever their case or spacing.
    assert s.grants.grant(f" {account.upper()} ", "admin.review") == "granted"
    assert probe.capabilities("acct-grant") == {"admin.review"}
    assert s.grants.revoke(account, "admin.review") == "revoked"
    assert probe.capabilities("acct-grant") == set()
    assert s.grants.revoke(account, "admin.review") == "not_granted"


def test_a_capability_a_plan_limits_cannot_be_granted(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.add_user("acct-limited", False, [])
    assert s.grants.grant(email_of("acct-limited"), "ai.notes.daily") == "limited"
    assert probe.capabilities("acct-limited") == set()


def test_guests_and_unknown_emails_cannot_be_granted(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.add_user("guest-grant2", True, [])
    assert s.grants.grant(email_of("guest-grant2"), "admin.review") == "no_account"
    assert probe.capabilities("guest-grant2") == set()
    nobody = "nobody@contract.example.test"
    assert s.grants.grant(nobody, "admin.review") == "no_account"
    assert s.grants.revoke(nobody, "admin.review") == "no_account"


def usage(user_id: str | None, cost: str, at: datetime) -> Usage:
    return Usage(
        user_id=user_id,
        feature="tagging",
        provider="openrouter",
        model="test-model",
        input_tokens=10,
        output_tokens=5,
        cost_usd=Decimal(cost),
        occurred_at=at,
    )


# OPS-4, Q-P1-23: spend per user and offline spend, per UTC day.
def test_ai_spend_is_summed_per_user_and_per_utc_day(
    ledger: tuple[AiLedger, Probe],
) -> None:
    ai, probe = ledger
    probe.add_user("ai-user", False, [])
    # A day far ahead, so rows other runs commit can't land in it.
    day = date(2099, 1, 2)
    ai.record(usage("ai-user", "0.10", datetime(2099, 1, 2, 0, 5, tzinfo=UTC)))
    ai.record(usage("ai-user", "0.05", datetime(2099, 1, 1, 23, 59, tzinfo=UTC)))
    ai.record(usage(None, "1.25", datetime(2099, 1, 2, 12, 0, tzinfo=UTC)))
    assert ai.spent_usd("ai-user", day) == Decimal("0.10")
    assert ai.spent_usd(None, day) == Decimal("1.25")
    assert ai.spent_usd("ai-user", date(2099, 1, 3)) == Decimal("0")


def test_a_deleted_users_spend_never_counts_as_offline_spend(
    ledger: tuple[AiLedger, Probe],
) -> None:
    ai, probe = ledger
    probe.add_user("ai-gone", False, [])
    ai.record(usage("ai-gone", "0.40", datetime(2099, 1, 4, 9, 0, tzinfo=UTC)))
    probe.delete_user("ai-gone")
    assert ai.spent_usd(None, date(2099, 1, 4)) == Decimal("0")


def test_ai_budgets_come_from_the_plan_and_the_global_row(
    ledger: tuple[AiLedger, Probe],
) -> None:
    ai, probe = ledger
    probe.add_user("ai-user2", False, [])
    assert ai.daily_budget_cents("ai-user2") == 50
    assert ai.daily_budget_cents(None) == 500
    # No plan grants an unknown user anything, so no AI either.
    assert ai.daily_budget_cents("nobody") == 0


def seed(
    name: str,
    *,
    rights_profile: RightsProfile = "full_text_internal",
    moments_enabled: bool = True,
    paywalled: bool = False,
    quality_score: int | None = None,
    topics: tuple[str, ...] = ("backend",),
) -> SourceSettings:
    return SourceSettings(
        name=name,
        homepage=None,
        feed_url=f"https://{name}.example.test/feed",
        rights_profile=rights_profile,
        moments_enabled=moments_enabled,
        paywalled=paywalled,
        quality_score=quality_score,
        topics=topics,
    )


# P1-W2-S01: the seed file is the truth for which sources exist and how they're set.
def test_syncing_the_seed_list_is_idempotent(store: tuple[Store, Probe]) -> None:
    s, probe = store
    seeds = [seed("sync-a", quality_score=4), seed("sync-b", paywalled=True)]
    first = s.sources.sync(seeds)
    assert (first.added, first.updated, first.unchanged) == (2, 0, 0)
    assert probe.source_state("sync-a") == (
        True,
        "https://sync-a.example.test/feed",
        "full_text_internal",
        True,
        False,
        4,
        ("backend",),
    )
    again = s.sources.sync(seeds)
    assert (again.added, again.updated, again.unchanged, again.deactivated) == (
        0,
        0,
        2,
        0,
    )


def test_a_source_removed_from_the_list_is_deactivated_and_keeps_its_items(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    s.sources.sync([seed("sync-keep"), seed("sync-drop")])
    source_id = s.sources.upsert(
        name="sync-drop",
        feed_url="https://sync-drop.example.test/feed",
        rights_profile="full_text_internal",
        homepage=None,
    )
    item = s.items.upsert_from_feed(
        source_id, entry("dropped-item"), keep_excerpt=False
    )
    result = s.sources.sync([seed("sync-keep")])
    assert result.deactivated >= 1
    state = probe.source_state("sync-drop")
    assert state is not None and state[0] is False
    assert probe.has_item(item)
    # Back in the file, back on.
    s.sources.sync([seed("sync-keep"), seed("sync-drop")])
    state = probe.source_state("sync-drop")
    assert state is not None and state[0] is True


def test_a_changed_seed_updates_its_source(store: tuple[Store, Probe]) -> None:
    s, probe = store
    s.sources.sync([seed("sync-edit")])
    result = s.sources.sync(
        [seed("sync-edit", quality_score=2, topics=("databases",), paywalled=True)]
    )
    assert (result.added, result.updated) == (0, 1)
    state = probe.source_state("sync-edit")
    assert state is not None
    assert state[4:] == (True, 2, ("databases",))


def test_lowering_a_profile_through_sync_purges_stored_text(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    s.sources.sync([seed("sync-lower")])
    source_id = s.sources.upsert(
        name="sync-lower",
        feed_url="https://sync-lower.example.test/feed",
        rights_profile="full_text_internal",
        homepage=None,
    )
    item = s.items.upsert_from_feed(source_id, entry("lower-item"), keep_excerpt=False)
    s.items.store_full_text(item, "body")
    s.sources.sync(
        [seed("sync-lower", rights_profile="metadata_only", moments_enabled=False)]
    )
    assert probe.full_text(item) is None


def test_a_renamed_source_with_the_same_feed_keeps_its_row(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    s.sources.sync([seed("sync-old")])
    source_id = s.sources.upsert(
        name="sync-old",
        feed_url="https://sync-old.example.test/feed",
        rights_profile="full_text_internal",
        homepage=None,
    )
    item = s.items.upsert_from_feed(
        source_id, entry("renamed-item"), keep_excerpt=False
    )
    renamed = replace(seed("sync-new"), feed_url="https://sync-old.example.test/feed")
    result = s.sources.sync([renamed])
    assert (result.added, result.updated) == (0, 1)
    assert probe.source_state("sync-old") is None
    state = probe.source_state("sync-new")
    assert state is not None and state[0] is True
    assert probe.has_item(item)


def test_a_source_ingest_one_made_is_adopted_by_its_feed(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    s.sources.upsert(
        name="adhoc-name",
        feed_url="https://adopted.example.test/feed",
        rights_profile="metadata_only",
        homepage=None,
    )
    adopted = replace(seed("adopted"), feed_url="https://adopted.example.test/feed")
    assert s.sources.sync([adopted]).updated == 1
    assert probe.source_state("adhoc-name") is None


def test_upsert_reactivates_a_source(store: tuple[Store, Probe]) -> None:
    s, probe = store
    s.sources.sync([seed("sync-off")])
    s.sources.sync([seed("sync-other")])
    s.sources.upsert(
        name="sync-off",
        feed_url="https://sync-off.example.test/feed",
        rights_profile="full_text_internal",
        homepage=None,
    )
    state = probe.source_state("sync-off")
    assert state is not None and state[0] is True


def test_switching_moments_off_through_sync_purges_moments(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    s.sources.sync([seed("sync-moments")])
    source_id = s.sources.upsert(
        name="sync-moments",
        feed_url="https://sync-moments.example.test/feed",
        rights_profile="full_text_internal",
        homepage=None,
    )
    probe.enable_moments(source_id)
    item = s.items.upsert_from_feed(source_id, entry("moment-item"), keep_excerpt=False)
    s.moments.replace(item, [moment(0, "m0")])
    # Same full-text profile, moments switched off in the same update.
    s.sources.sync([seed("sync-moments", moments_enabled=False, quality_score=3)])
    assert probe.moments(item) == []


def test_active_ids_lists_only_sources_still_in_the_seed_list(
    store: tuple[Store, Probe],
) -> None:
    s, _ = store
    s.sources.sync([seed("act-a"), seed("act-b")])
    s.sources.sync([seed("act-a")])  # act-b removed: inactive
    feeds = {
        record.feed_url
        for record in (s.sources.get(i) for i in s.sources.active_ids())
        if record is not None
    }
    assert "https://act-a.example.test/feed" in feeds
    assert "https://act-b.example.test/feed" not in feeds


# W2-S02b: what the pipeline's stages read.
def test_what_the_fetch_and_segment_stages_read(store: tuple[Store, Probe]) -> None:
    s, _ = store
    source_id = s.sources.upsert(
        name="stage-reads",
        feed_url="https://stage-reads.example.test/feed",
        rights_profile="full_text_internal",
        homepage=None,
    )
    item = s.items.upsert_from_feed(source_id, entry("stage"), keep_excerpt=False)
    fetch = s.items.for_fetch(item)
    assert fetch is not None
    assert fetch.rights_profile == "full_text_internal"
    assert fetch.canonical_url == "https://contract.example.test/stage"
    assert s.items.for_fetch(10**9) is None
    assert s.items.has_body(item) is False
    s.items.store_full_text(item, "body")
    assert s.items.has_body(item) is True
    assert s.moments.exist(item) is False


def test_fetch_validators_are_kept_per_url(store: tuple[Store, Probe]) -> None:
    s, _ = store
    url = "https://validators.example.test/feed"
    assert s.validators.get(url) is None
    s.validators.put(url, Validators('"v1"', None))
    assert s.validators.get(url) == Validators('"v1"', None)
    s.validators.put(url, Validators(None, "Mon, 26 Oct 2026 01:00:00 GMT"))
    assert s.validators.get(url) == Validators(None, "Mon, 26 Oct 2026 01:00:00 GMT")
    s.validators.put(url, None)  # the server stopped sending them
    assert s.validators.get(url) is None


# ING-1 normalize (Q-P1-08): duplicates link to the earliest-published item.
def dup_source(
    s: Store, name: str, profile: RightsProfile = "full_text_internal"
) -> int:
    return s.sources.upsert(
        name=f"dup-{name}",
        feed_url=f"https://dup-{name}.example.test/feed.xml",
        rights_profile=profile,
        homepage=None,
    )


def dup_item(
    s: Store,
    source_id: int,
    guid: str,
    day: int,
    url: str | None = None,
    title: str | None = None,
    author: str | None = None,
) -> int:
    return s.items.upsert_from_feed(
        source_id,
        FeedEntry(
            guid=f"contract-dup-{guid}",
            link=url or f"https://dup.example.test/{guid}",
            title=title or f"Unique title {guid}",
            author=author,
            published_at=datetime(2099, 11, day, tzinfo=UTC),
            updated_at=None,
            summary=None,
        ),
        keep_excerpt=False,
    )


A_HASH = 0x0F0F_0F0F_0F0F_0F0F
NEAR_A = A_HASH ^ 0b101  # two bits away
FAR_FROM_A = A_HASH ^ 0xFFFF


def test_the_same_canonical_url_on_two_sources_is_one_article(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    first = dup_item(
        s, dup_source(s, "a"), "x1", 2, url="https://dup.example.test/same"
    )
    later = dup_item(
        s, dup_source(s, "b"), "x2", 5, url="https://dup.example.test/same"
    )
    assert s.items.link_duplicates(later) == first
    assert (probe.primary_of(first), probe.primary_of(later)) == (None, first)


def test_near_simhashes_link_and_far_ones_do_not(store: tuple[Store, Probe]) -> None:
    s, probe = store
    a = dup_item(s, dup_source(s, "a"), "s1", 2)
    near = dup_item(s, dup_source(s, "b"), "s2", 3)
    far = dup_item(s, dup_source(s, "c"), "s3", 4)
    for item, value in ((a, A_HASH), (near, NEAR_A), (far, FAR_FROM_A)):
        s.items.store_full_text(item, "body")
        s.items.set_simhash(item, value)
        s.items.link_duplicates(item)
    assert (probe.primary_of(near), probe.primary_of(far)) == (a, None)


def test_without_body_text_title_author_and_date_decide(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    a = dup_source(s, "a", "metadata_only")
    b = dup_source(s, "b", "metadata_only")
    first = dup_item(s, a, "m1", 2, title="Queues  In Depth", author="Ann")
    same = dup_item(s, b, "m2", 2, title="queues in depth", author="Ann")
    other_day = dup_item(s, b, "m3", 9, title="Queues in depth", author="Ann")
    for item in (first, same, other_day):
        s.items.link_duplicates(item)
    assert (probe.primary_of(same), probe.primary_of(other_day)) == (first, None)


def test_two_bodies_far_apart_are_not_duplicates_despite_matching_metadata(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    a = dup_item(s, dup_source(s, "a"), "f1", 2, title="Weekly notes", author="Bo")
    b = dup_item(s, dup_source(s, "b"), "f2", 2, title="Weekly notes", author="Bo")
    for item, value in ((a, A_HASH), (b, FAR_FROM_A)):
        s.items.store_full_text(item, "body")
        s.items.set_simhash(item, value)
        s.items.link_duplicates(item)
    assert probe.primary_of(b) is None


def test_an_earlier_newcomer_becomes_the_primary(store: tuple[Store, Probe]) -> None:
    s, probe = store
    url = "https://dup.example.test/backfilled"
    later = dup_item(s, dup_source(s, "a"), "e1", 20, url=url)
    middle = dup_item(s, dup_source(s, "b"), "e2", 10, url=url)
    s.items.link_duplicates(middle)
    earliest = dup_item(s, dup_source(s, "c"), "e3", 1, url=url)
    assert s.items.link_duplicates(earliest) == earliest
    assert [probe.primary_of(i) for i in (earliest, middle, later)] == [
        None,
        earliest,
        earliest,
    ]


def test_a_simhash_needs_full_text_rights_and_goes_when_they_do(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    excerpt = dup_item(s, dup_source(s, "ex", "excerpt"), "r1", 2)
    with pytest.raises(RightsViolation):
        s.items.set_simhash(excerpt, A_HASH)
    sid = dup_source(s, "lowered")
    item = dup_item(s, sid, "r2", 2)
    s.items.store_full_text(item, "body")
    s.items.set_simhash(item, A_HASH)
    s.sources.upsert(
        name="dup-lowered",
        feed_url="https://dup-lowered.example.test/feed.xml",
        rights_profile="metadata_only",
        homepage=None,
    )
    assert probe.simhash(item) is None


def test_a_poll_keeps_the_canonical_url_the_fetch_found(
    store: tuple[Store, Probe],
) -> None:
    s, _ = store
    sid = dup_source(s, "a")
    item = dup_item(s, sid, "c1", 2, url="https://dup.example.test/c1?page=1")
    s.items.set_canonical(item, "https://dup.example.test/c1")
    dup_item(s, sid, "c1", 2, url="https://dup.example.test/c1?page=1")  # next poll
    fetch = s.items.for_fetch(item)
    assert fetch is not None
    assert fetch.canonical_url == "https://dup.example.test/c1"


def test_the_feed_shows_only_the_primary(store: tuple[Store, Probe]) -> None:
    s, probe = store
    url = "https://dup.example.test/feed-dup"
    a, b = dup_source(s, "a"), dup_source(s, "b")
    probe.enable_moments(a)
    probe.enable_moments(b)
    primary = dup_item(s, a, "d1", 2, url=url)
    copy = dup_item(s, b, "d2", 3, url=url)
    s.moments.replace(primary, [moment(0, "dup-primary")])
    s.moments.replace(copy, [moment(0, "dup-copy")])
    s.items.link_duplicates(copy)
    s.feed.rebuild()
    titles = probe.feed_titles()
    assert "dup-primary" in titles
    assert "dup-copy" not in titles


def test_a_missing_author_or_date_never_matches_on_metadata(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    a = dup_source(s, "a", "metadata_only")
    b = dup_source(s, "b", "metadata_only")
    first = dup_item(s, a, "n1", 2, title="Weekly links")
    unnamed = dup_item(s, b, "n2", 2, title="Weekly links")
    one_named = dup_item(s, b, "n3", 2, title="Weekly links", author="Cy")
    for item in (first, unnamed, one_named):
        s.items.link_duplicates(item)
    assert (probe.primary_of(unnamed), probe.primary_of(one_named)) == (None, None)
    undated_a = s.items.upsert_from_feed(a, undated_entry("u1"), keep_excerpt=False)
    undated_b = s.items.upsert_from_feed(b, undated_entry("u2"), keep_excerpt=False)
    s.items.link_duplicates(undated_b)
    assert (probe.primary_of(undated_a), probe.primary_of(undated_b)) == (None, None)


def undated_entry(guid: str) -> FeedEntry:
    return FeedEntry(
        guid=f"contract-dup-{guid}",
        link=f"https://dup.example.test/{guid}",
        title="Undated post",
        author="Di",
        published_at=None,
        updated_at=None,
        summary=None,
    )


def test_titles_match_across_ascii_spacing_and_case_in_every_store(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    a = dup_source(s, "a", "metadata_only")
    b = dup_source(s, "b", "metadata_only")
    nbsp = dup_item(s, a, "w1", 2, title="Queues\u00a0in depth", author="Ann")
    spaced = dup_item(s, a, "w2", 2, title="Queues in depth", author="Ann")
    tabbed = dup_item(s, b, "w3", 2, title="  queues\tin  DEPTH ", author="ann")
    for item in (nbsp, spaced, tabbed):
        s.items.link_duplicates(item)
    # A no-break space is not whitespace to Postgres; the fake must agree.
    assert probe.primary_of(nbsp) is None
    assert probe.primary_of(tabbed) == spaced


def test_an_item_bridging_two_groups_merges_them(store: tuple[Store, Probe]) -> None:
    s, probe = store
    x_url, y_url = "https://dup.example.test/gx", "https://dup.example.test/gy"
    x1 = dup_item(s, dup_source(s, "a"), "g1", 1, url=x_url)
    x2 = dup_item(s, dup_source(s, "b"), "g2", 5, url=x_url)
    y1 = dup_item(
        s, dup_source(s, "c"), "g3", 3, url=y_url, title="Bridge", author="Ed"
    )
    y2 = dup_item(s, dup_source(s, "d"), "g4", 6, url=y_url)
    s.items.link_duplicates(x2)
    s.items.link_duplicates(y2)
    assert probe.primary_of(y2) == y1
    # A metadata-only listing with x's link and y1's title, author and day.
    listing = dup_source(s, "e", "metadata_only")
    bridge = dup_item(s, listing, "g5", 3, url=x_url, title="Bridge", author="Ed")
    assert s.items.link_duplicates(bridge) == x1
    assert [probe.primary_of(i) for i in (x1, x2, y1, y2, bridge)] == [
        None,
        x1,
        x1,
        x1,
        x1,
    ]


def test_the_feed_keeps_the_earliest_copy_that_has_moments(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    url = "https://dup.example.test/syndicated"
    listing = dup_item(s, dup_source(s, "listing", "metadata_only"), "k1", 1, url=url)
    original_source = dup_source(s, "original")
    probe.enable_moments(original_source)
    original = dup_item(s, original_source, "k2", 2, url=url)
    s.moments.replace(original, [moment(0, "dup-original")])
    s.items.link_duplicates(original)
    s.feed.rebuild()
    assert probe.primary_of(original) == listing
    assert "dup-original" in probe.feed_titles()


# ING-3 adaptive polling (P1-W2-S03).
def test_claiming_due_sources_pushes_each_to_its_next_turn(
    store: tuple[Store, Probe],
) -> None:
    s, _ = store
    now = datetime(2099, 1, 1, 12, tzinfo=UTC)
    due = dup_source(s, "due")
    later = dup_source(s, "later")
    # Polled an hour ago at a 2-hour interval: due an hour from now.
    s.sources.record_poll(later, timedelta(hours=2), now - timedelta(hours=1))
    claimed = s.sources.claim_due(now)
    assert due in claimed and later not in claimed
    assert due not in s.sources.claim_due(now + timedelta(minutes=5))
    record = s.sources.get(due)
    assert record is not None
    # Claimed for one interval (an hour): a lost discover is polled again after it,
    # and the source scheduled for that hour comes due with it.
    assert record.poll_interval == timedelta(hours=1)
    again = s.sources.claim_due(now + record.poll_interval)
    assert due in again and later in again


def test_a_new_source_is_due_at_once_with_the_starting_interval(
    store: tuple[Store, Probe],
) -> None:
    s, _ = store
    sid = dup_source(s, "new")
    record = s.sources.get(sid)
    assert record is not None and record.poll_interval == timedelta(hours=1)
    assert sid in s.sources.claim_due(datetime(2099, 1, 1, tzinfo=UTC))


def test_an_inactive_source_is_never_claimed(store: tuple[Store, Probe]) -> None:
    s, _ = store
    sid = dup_source(s, "kept")
    s.sources.sync([])  # removed from the seed list
    assert sid not in s.sources.claim_due(datetime(2099, 1, 1, tzinfo=UTC))


def test_known_guids_tell_new_entries_from_seen_ones(
    store: tuple[Store, Probe],
) -> None:
    s, _ = store
    sid = dup_source(s, "guids")
    dup_item(s, sid, "seen", 2)
    other = dup_source(s, "other")
    dup_item(s, other, "elsewhere", 2)
    assert s.items.known_guids(
        sid, ["contract-dup-seen", "contract-dup-new", "contract-dup-elsewhere"]
    ) == {"contract-dup-seen"}


# DB-2 concept graph (P1-W3-S01, Q-P1-04).
def graph(version: int, body: str) -> ConceptGraph:
    return parse_concepts(f"version: {version}\nconcepts:\n{body}", "c.yaml")


CHAIN = """
  - {slug: cg-replication, name: Replication, topic: distributed-systems}
  - {slug: cg-lag, name: Lag, topic: distributed-systems,
     prerequisites: [cg-replication]}
  - {slug: cg-ryw, name: RYW, topic: distributed-systems, prerequisites: [cg-lag]}
  - {slug: cg-quorum, name: Quorum, topic: distributed-systems, related: [cg-lag]}
"""


def test_a_loaded_graph_answers_recursive_prerequisites(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.reset_concepts()
    result = sync_concepts(s, graph(1, CHAIN))
    assert (result.added, result.retired) == (4, 0)
    assert s.concepts.prerequisites("cg-ryw") == {"cg-lag", "cg-replication"}
    assert s.concepts.prerequisites("cg-replication") == set()
    # "related to" is not a prerequisite.
    assert s.concepts.prerequisites("cg-quorum") == set()


def test_loading_the_same_file_again_changes_nothing(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.reset_concepts()
    sync_concepts(s, graph(1, CHAIN))
    assert sync_concepts(s, graph(1, CHAIN)).changed is False


def test_a_changed_file_must_bump_its_version(store: tuple[Store, Probe]) -> None:
    s, probe = store
    probe.reset_concepts()
    sync_concepts(s, graph(1, CHAIN))
    renamed = CHAIN.replace("name: RYW", "name: Read your writes")
    with pytest.raises(ConceptSeedError, match="version"):
        sync_concepts(s, graph(1, renamed))
    assert sync_concepts(s, graph(2, renamed)).updated == 1


def test_a_concept_dropped_from_the_file_is_retired_and_stays_readable(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.reset_concepts()
    sync_concepts(s, graph(1, CHAIN))
    without_lag = """
  - {slug: cg-replication, name: Replication, topic: distributed-systems}
  - {slug: cg-ryw, name: RYW, topic: distributed-systems,
     prerequisites: [cg-replication]}
  - {slug: cg-quorum, name: Quorum, topic: distributed-systems}
"""
    assert sync_concepts(s, graph(2, without_lag)).retired == 1
    lag = s.concepts.get("cg-lag")
    assert lag is not None and lag.retired and lag.name == "Lag"
    assert s.concepts.prerequisites("cg-ryw") == {"cg-replication"}


def test_a_merged_concept_points_at_its_replacement(store: tuple[Store, Probe]) -> None:
    s, probe = store
    probe.reset_concepts()
    body = (
        CHAIN
        + "  - {slug: cg-old-lag, name: Old, topic: backend, merged_into: cg-lag}\n"
    )
    sync_concepts(s, graph(1, body))
    old = s.concepts.get("cg-old-lag")
    assert old is not None and (old.retired, old.merged_into) == (True, "cg-lag")


def test_the_store_refuses_a_prerequisite_cycle_the_parser_did_not_see(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.reset_concepts()
    sync_concepts(s, graph(1, CHAIN))
    current = s.concepts.state()
    assert current is not None
    closing: set[ConceptEdge] = {("cg-ryw", "cg-replication", "prerequisite_of")}
    looped = ConceptGraph(
        2,
        current.concepts,
        current.edges | closing,
    )
    with pytest.raises(ConceptCycleError):
        s.concepts.apply(looped)


def test_a_retired_or_merged_concept_can_come_back(store: tuple[Store, Probe]) -> None:
    s, probe = store
    probe.reset_concepts()
    old_lag = "{slug: cg-old-lag, name: Old, topic: backend, merged_into: cg-lag}"
    sync_concepts(s, graph(1, CHAIN + f"  - {old_lag}\n"))
    revived = CHAIN + "  - {slug: cg-old-lag, name: Old, topic: backend}\n"
    sync_concepts(s, graph(2, revived))
    back = s.concepts.get("cg-old-lag")
    assert back is not None and (back.retired, back.merged_into) == (False, None)


def test_an_older_file_with_unchanged_content_is_a_no_op(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.reset_concepts()
    sync_concepts(s, graph(3, CHAIN))
    assert sync_concepts(s, graph(1, CHAIN)).changed is False


def test_postgres_refuses_deleting_a_concept_and_unknown_edge_types(
    conn: psycopg.Connection,
) -> None:
    # Tags and learner state reference concepts (W3-S02 on): they must never dangle.
    PostgresProbe(conn).reset_concepts()
    sync_concepts(PostgresStore(conn), graph(1, CHAIN))
    with pytest.raises(psycopg.errors.RaiseException), conn.transaction():
        conn.execute("delete from concept where slug = 'cg-lag'")
    with pytest.raises(psycopg.errors.InvalidTextRepresentation), conn.transaction():
        conn.execute(
            "insert into concept_edge (from_id, to_id, type) select a.id, b.id, "
            "'depends_on' from concept a, concept b "
            "where a.slug = 'cg-lag' and b.slug = 'cg-ryw'"
        )


# AI-3 tags (P1-W3-S02): stored apart from source text, readable after a retirement.
def test_tags_are_saved_replaced_and_survive_retiring_their_concept(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.reset_concepts()
    sync_concepts(s, graph(1, CHAIN))
    sid = source(s)
    probe.enable_moments(sid)
    item = s.items.upsert_from_feed(sid, entry("tags"), keep_excerpt=False)
    s.items.store_full_text(item, "Intro\nLag\nbody")
    s.moments.replace(item, [moment(0, "intro"), moment(1, "Lag")])
    tag_input = s.tags.input(item)
    assert tag_input is not None and tag_input.full_text == "Intro\nLag\nbody"
    assert [m.ordinal for m in tag_input.moments] == [0, 1]
    second = tag_input.moments[1].id
    result = TagResult(
        Tags("intermediate", frozenset({"cg-lag", "cg-replication"})),
        {second: Tags("advanced", frozenset({"cg-lag"}))},
    )
    s.tags.save(item, result, "small-model", 1)
    assert s.tags.version(item) == 1
    assert s.tags.for_item(item) == (result.item, {1: result.moments[second]})
    # Retire cg-lag: its tags still read back (tags never dangle, Q-P1-04).
    without_lag = (
        CHAIN.replace(
            "  - {slug: cg-lag, name: Lag, topic: distributed-systems,\n"
            "     prerequisites: [cg-replication]}\n",
            "",
        )
        .replace("prerequisites: [cg-lag]", "prerequisites: [cg-replication]")
        .replace(", related: [cg-lag]", "")
    )
    sync_concepts(s, graph(2, without_lag))
    assert s.tags.for_item(item)[0] == result.item
    # A new prompt version replaces the tags.
    again = TagResult(Tags("beginner", frozenset({"cg-replication"})), {})
    s.tags.save(item, again, "small-model", 2)
    assert s.tags.for_item(item) == (again.item, {})
    assert s.tags.version(item) == 2


def test_tag_reads_respect_rights_and_saves_refuse_foreign_moments(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.reset_concepts()
    sync_concepts(s, graph(1, CHAIN))
    sid = source(s)
    probe.enable_moments(sid)
    item = s.items.upsert_from_feed(sid, entry("rights"), keep_excerpt=False)
    other = s.items.upsert_from_feed(sid, entry("rights-other"), keep_excerpt=False)
    s.items.store_full_text(item, "body")
    s.moments.replace(other, [moment(0, "theirs")])
    assert s.tags.find("https://contract.example.test/rights") == item
    assert s.tags.needs_tagging(item, 1) is True
    theirs = probe.moments(other)[0][0]
    foreign = TagResult(
        Tags("beginner", frozenset()), {theirs: Tags("beginner", frozenset())}
    )
    with pytest.raises(ValueError, match="not item"):
        s.tags.save(item, foreign, "m", 1)
    s.tags.save(item, TagResult(Tags("beginner", frozenset()), {}), "m", 1)
    assert s.tags.needs_tagging(item, 1) is False
    assert s.tags.needs_tagging(item, 2) is True
    s.tags.clear(item)
    assert s.tags.version(item) is None
    # Lowered to excerpt: the stored body is purged and never read for tagging.
    change_profile(s, "full_text_internal", "excerpt")
    tag_input = s.tags.input(item)
    assert tag_input is not None and tag_input.full_text is None


# DB-3 embeddings (P1-W3-S04): one query filters by rights, source and difficulty.
def unit(*first: float) -> list[float]:
    return [*first, *([0.0] * (1024 - len(first)))]


def test_similar_moments_filter_by_rights_source_and_difficulty(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    a, b = dup_source(s, "emb-a"), dup_source(s, "emb-b")
    for sid in (a, b):
        probe.enable_moments(sid)
    item_a = dup_item(s, a, "emb1", 2)
    item_b = dup_item(s, b, "emb2", 3)
    a1_row = replace(moment(1, "a1"), link_type="anchor")  # starts at heading "a1"
    s.moments.replace(item_a, [moment(0, "a0"), a1_row])
    s.moments.replace(item_b, [moment(0, "b0")])
    a0, a1 = (m[0] for m in probe.moments(item_a))
    (b0,) = (m[0] for m in probe.moments(item_b))
    assert s.embeddings.missing(item_a, "voyage-3.5") is True
    s.embeddings.save(item_a, {a0: unit(1, 0)}, "voyage-3.5", complete=False)
    # Part way (a budget stop): still missing, and the done moment is skipped next.
    assert s.embeddings.missing(item_a, "voyage-3.5") is True
    assert s.embeddings.done(item_a, "voyage-3.5") == {a0}
    s.embeddings.save(item_a, {a1: unit(0.7, 0.7)}, "voyage-3.5", complete=True)
    s.embeddings.save(item_b, {b0: unit(0.9, 0.1)}, "voyage-3.5", complete=True)
    assert s.embeddings.missing(item_a, "voyage-3.5") is False
    assert s.embeddings.missing(item_a, "voyage-3-large") is True
    s.tags.save(
        item_a,
        TagResult(
            Tags("beginner", frozenset()),
            {a0: Tags("advanced", frozenset()), a1: Tags("beginner", frozenset())},
        ),
        "m",
        1,
    )
    query = unit(1, 0)
    ours = {a0, a1, b0}
    hits = [h.moment_id for h in s.embeddings.similar(query, 50) if h.moment_id in ours]
    assert hits == [a0, b0, a1]  # nearest first
    # Vectors from another model aren't comparable, so they never match (P1-W4-S02).
    other = s.embeddings.similar(query, 50, model="voyage-3-large")
    assert not [h for h in other if h.moment_id in ours]
    assert s.embeddings.vectors_of_item(item_b, "voyage-3.5")[0][:2] == [0.9, 0.1]
    by_source = s.embeddings.similar(query, 50, source_ids=[b])
    assert [h.moment_id for h in by_source] == [b0]
    by_level = s.embeddings.similar(query, 50, difficulties=["beginner"])
    assert [h.moment_id for h in by_level if h.moment_id in ours] == [a1]
    # An admin's correction of a1's level wins (P1-W3-S05).
    probe.override_level(item_a, "a1", "advanced")
    by_level = s.embeddings.similar(query, 50, difficulties=["beginner"])
    assert [h.moment_id for h in by_level if h.moment_id in ours] == []
    # Lowering a source's rights removes its moments, and so their vectors.
    s.sources.upsert(
        name="dup-emb-b",
        feed_url="https://dup-emb-b.example.test/feed.xml",
        rights_profile="excerpt",
        homepage=None,
    )
    assert s.embeddings.similar(query, 50, source_ids=[b]) == []


def test_saving_vectors_for_another_items_moments_is_refused(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    sid = dup_source(s, "emb-c")
    probe.enable_moments(sid)
    mine, theirs = dup_item(s, sid, "emb3", 2), dup_item(s, sid, "emb4", 2)
    s.moments.replace(theirs, [moment(0, "t0")])
    (t0,) = (m[0] for m in probe.moments(theirs))
    with pytest.raises(ValueError, match="not item"):
        s.embeddings.save(mine, {t0: unit(1)}, "voyage-3.5", complete=True)


def test_a_duplicate_or_momentless_item_never_needs_embedding(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    url = "https://dup.example.test/emb-dup"
    a, b = dup_source(s, "emb-d1"), dup_source(s, "emb-d2")
    probe.enable_moments(a)
    probe.enable_moments(b)
    primary, copy = dup_item(s, a, "ed1", 1, url=url), dup_item(s, b, "ed2", 2, url=url)
    assert s.embeddings.missing(primary, "voyage-3.5") is False  # no moments yet
    s.moments.replace(primary, [moment(0, "p0")])
    s.moments.replace(copy, [moment(0, "c0")])
    s.items.link_duplicates(copy)
    assert s.embeddings.missing(primary, "voyage-3.5") is True
    assert s.embeddings.missing(copy, "voyage-3.5") is False


# ING-6 admin review (P1-W3-S05): segmentation reads the admin's boundaries.
def test_the_boundary_override_is_read_for_segmentation(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    item = s.items.upsert_from_feed(source(s), entry("bounds"), keep_excerpt=False)
    assert s.items.boundary_override(item) is None
    probe.set_boundaries(item, ["Setup", "Recovery"])
    assert s.items.boundary_override(item) == ["Setup", "Recovery"]


def test_re_ingesting_leaves_the_admins_overrides_alone(
    conn: psycopg.Connection,
) -> None:
    # P1-W3-S05: tags and moments are redone on re-ingestion; overrides are not.
    s = PostgresStore(conn)
    sid = source(s)
    PostgresProbe(conn).enable_moments(sid)
    item = s.items.upsert_from_feed(sid, entry("survive"), keep_excerpt=False)
    s.moments.replace(item, [moment(0, "intro"), moment(1, "Setup")])
    conn.execute(
        "insert into tag_override (content_item_id, heading, difficulty, concepts, "
        "updated_by) values (%s, 'Setup', 'advanced', '{}', 'admin')",
        (item,),
    )
    PostgresProbe(conn).set_boundaries(item, ["Setup"])
    s.tags.clear(item)
    s.embeddings.clear(item)
    s.moments.replace(item, [moment(0, "intro")])
    s.items.upsert_from_feed(sid, entry("survive"), keep_excerpt=False)
    rows = conn.execute(
        "select (select count(*) from tag_override where content_item_id = %s), "
        "(select count(*) from moment_boundary_override where content_item_id = %s)",
        (item, item),
    ).fetchone()
    assert rows == (1, 1)


# P1-W3-S06: an admin's moments switch survives a seed reload.
def test_an_admins_moments_switch_survives_seed_reloads(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    s.sources.sync([seed("switched")])
    sid = s.sources.upsert(
        name="switched",
        feed_url="https://switched.example.test/feed",
        rights_profile="full_text_internal",
        homepage=None,
    )
    item = s.items.upsert_from_feed(sid, entry("switched-item"), keep_excerpt=False)
    s.moments.replace(item, [moment(0, "sw0")])
    s.feed.rebuild()
    assert "sw0" in probe.feed_titles()
    probe.switch_moments_off(sid, True)
    assert probe.moments(item) == []  # purged: gone from the feed at once
    assert "sw0" not in probe.feed_titles()
    s.sources.sync([seed("switched")])  # unchanged file
    s.sources.sync([seed("switched", quality_score=4)])  # a changed one
    record = s.sources.get(sid)
    assert record is not None and record.moments_enabled is False
    probe.switch_moments_off(sid, False)  # back to what the seed file says
    record = s.sources.get(sid)
    assert record is not None and record.moments_enabled is True


def test_the_seed_file_and_the_admin_switch_both_have_to_allow_moments(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    s.sources.sync([seed("both")])
    sid = s.sources.upsert(
        name="both",
        feed_url="https://both.example.test/feed",
        rights_profile="full_text_internal",
        homepage=None,
    )
    probe.switch_moments_off(sid, True)
    s.sources.sync([seed("both", moments_enabled=False)])
    s.sources.sync([seed("both", moments_enabled=True)])  # seed back on: still off
    record = s.sources.get(sid)
    assert record is not None and record.moments_enabled is False
    probe.switch_moments_off(sid, False)
    s.sources.sync([seed("both", moments_enabled=False)])  # now the seed says off
    record = s.sources.get(sid)
    assert record is not None and record.moments_enabled is False


# REC-1 (P1-W4-S02): what ranking reads about a user.
def test_readers_return_preferences_feedback_and_topic_moments(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.reset_concepts()
    sync_concepts(
        s,
        parse_concepts(
            "version: 1\nconcepts:\n"
            "  - {slug: rd-raft, name: Raft, topic: distributed-systems}\n"
            "  - {slug: rd-index, name: Index, topic: databases}\n",
            "c.yaml",
        ),
    )
    user = f"readers-{uuid4().hex[:8]}"
    probe.add_user(user, False, [])
    assert s.ranking.preferences(user) is None
    probe.set_preferences(user, ["databases", "backend"])
    prefs = s.ranking.preferences(user)
    assert prefs is not None and prefs.topics == ["databases", "backend"]

    plain = dup_source(s, "rd-plain")  # seed topics: none
    probe.enable_moments(plain)
    by_tag = dup_item(s, plain, "rd1", 3)
    by_correction = dup_item(s, plain, "rd2", 2)
    off_topic = dup_item(s, plain, "rd3", 1)
    for item in (by_tag, by_correction, off_topic):
        s.moments.replace(item, [moment(0, f"rd-{item}")])
    s.tags.save(
        by_tag, TagResult(Tags("beginner", frozenset({"rd-index"})), {}), "m", 1
    )
    s.tags.save(
        by_correction, TagResult(Tags("beginner", frozenset({"rd-raft"})), {}), "m", 1
    )
    probe.correct_concepts(by_correction, ["rd-index"])  # the admin wins
    s.tags.save(
        off_topic, TagResult(Tags("beginner", frozenset({"rd-raft"})), {}), "m", 1
    )
    mine = {by_tag, by_correction, off_topic}
    rows = s.ranking.topic_moments(
        ["databases"], 1000, exclude_sources=set(), exclude_items=set()
    )
    assert [r.item_id for r in rows if r.item_id in mine] == [by_tag, by_correction]

    probe.give_feedback(user, by_tag, "not_interested")
    probe.give_feedback(user, by_correction, "more_like_this")
    probe.hide_source(user, plain)
    assert s.ranking.not_interested(user) == {by_tag}
    assert s.ranking.liked_items(user, 5) == [by_correction]
    assert s.ranking.hidden_sources(user) == {plain}
    rows = s.ranking.topic_moments(
        ["databases"], 1000, exclude_sources={plain}, exclude_items=set()
    )
    assert not [r for r in rows if r.item_id in mine]


def test_topic_moments_offer_the_shown_copy_of_active_sources_in_order(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.reset_concepts()
    sync_concepts(
        s,
        parse_concepts(
            "version: 1\nconcepts:\n  - {slug: tm-idx, name: I, topic: databases}\n",
            "c.yaml",
        ),
    )
    url = "https://dup.example.test/tm-shared"
    listing = dup_item(s, dup_source(s, "tm-list", "metadata_only"), "tm1", 1, url=url)
    full = dup_source(s, "tm-full")
    probe.enable_moments(full)
    original = dup_item(s, full, "tm2", 2, url=url)
    s.items.link_duplicates(original)
    newer = dup_item(s, full, "tm3", 5)
    emptied = dup_item(s, full, "tm4", 4)
    for item in (original, newer, emptied):
        s.moments.replace(item, [moment(0, f"tm-{item}a"), moment(1, f"tm-{item}b")])
        s.tags.save(
            item, TagResult(Tags("beginner", frozenset({"tm-idx"})), {}), "m", 1
        )
    probe.correct_concepts(emptied, [])  # an admin removed every concept: no match

    def offered(limit: int = 1000) -> list[tuple[int, int]]:
        rows = s.ranking.topic_moments(
            ["databases"], limit, exclude_sources=set(), exclude_items=set()
        )
        mine = {original, newer, emptied, listing}
        return [(r.item_id, r.moment_id) for r in rows if r.item_id in mine]

    got = offered()
    # The original (a full-text duplicate of an earlier metadata-only listing) is
    # offered; the listing has no moments. Newest item first, then reading order.
    assert [item for item, _ in got] == [newer, newer, original, original]
    assert got[0][1] < got[1][1]
    assert (
        s.ranking.topic_moments([], 10, exclude_sources=set(), exclude_items=set())
        == []
    )
    s.sources.sync([seed("other-only")])  # tm-full leaves the seed list: inactive
    assert offered() == []


# REC-2 scoring inputs (P1-W4-S03).
def test_the_fakes_ranking_config_matches_the_migrations_seed(
    conn: psycopg.Connection,
) -> None:
    assert PostgresStore(conn).ranking.config() == RANKING_DEFAULTS


def test_moment_facts_and_feedback_for_scoring(store: tuple[Store, Probe]) -> None:
    s, probe = store
    probe.reset_concepts()
    sync_concepts(
        s,
        parse_concepts(
            "version: 1\nconcepts:\n"
            "  - {slug: sf-a, name: A, topic: databases}\n"
            "  - {slug: sf-b, name: B, topic: databases}\n",
            "c.yaml",
        ),
    )
    user = f"scoring-{uuid4().hex[:8]}"
    probe.add_user(user, False, [])
    sid = dup_source(s, "sf")
    probe.enable_moments(sid)
    item = dup_item(s, sid, "sf1", 7)
    disliked = dup_item(s, sid, "sf2", 6)
    heading_row = replace(moment(1, "Setup"), link_type="anchor")
    tuning_row = replace(moment(2, "Tuning"), link_type="anchor")
    s.moments.replace(item, [moment(0, "intro"), heading_row, tuning_row])
    s.moments.replace(disliked, [moment(0, "d0")])
    intro, setup, tuning = (m[0] for m in probe.moments(item))
    s.tags.save(
        item,
        TagResult(
            Tags("beginner", frozenset({"sf-a"})),
            {
                setup: Tags("advanced", frozenset()),
                tuning: Tags("beginner", frozenset()),
            },
        ),
        "m",
        1,
    )
    s.tags.save(disliked, TagResult(Tags("beginner", frozenset({"sf-b"})), {}), "m", 1)
    probe.override_level(item, "Setup", "intermediate")  # the admin wins
    facts = s.ranking.moment_facts([intro, setup, tuning])
    assert facts[setup].difficulty == "intermediate"
    assert facts[intro].difficulty == "beginner"  # no moment tag: the item's level
    assert facts[tuning].difficulty == "beginner"  # the model's moment tag
    assert facts[intro].concepts == frozenset({"sf-a"})
    assert facts[intro].minutes == 1 and facts[intro].item_id == item
    # Topics: the source's seed topics plus the topics of the item's concepts.
    assert facts[intro].topics == frozenset({"databases"})
    assert facts[intro].quality is None and facts[intro].source_id == sid
    assert facts[intro].published_at == datetime(2099, 11, 7, tzinfo=UTC)
    # Owner, 2026-10-26: an admin's item correction beats every model tag; only the
    # admin's own moment correction is more specific.
    probe.override_level(item, "", "advanced")
    facts = s.ranking.moment_facts([intro, setup, tuning])
    assert facts[tuning].difficulty == "advanced"
    assert facts[intro].difficulty == "advanced"
    assert facts[setup].difficulty == "intermediate"
    probe.give_feedback(user, item, "less_like_this")
    probe.give_feedback(user, disliked, "not_interested")
    assert s.ranking.less_liked(user) == {item}
    assert s.ranking.avoided_concepts(user) == frozenset({"sf-b"})
    probe.correct_concepts(disliked, ["sf-a"])  # an admin's correction replaces them
    assert s.ranking.avoided_concepts(user) == frozenset({"sf-a"})
