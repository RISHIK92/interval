"""Store contract (ADR-0012): the same repository cases against the in-memory fake and
the Postgres adapter, so logic tested on the fake behaves the same on the database.

Ports have no read methods that only tests need; each store gets a test-side probe that
inspects its state (internal fields for the fake, SQL for Postgres).
"""

from collections.abc import Iterator
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Protocol

import psycopg
import pytest

from interval_db.generated import RightsProfile
from interval_jobs.adapters.memory import InMemoryAi, InMemoryStore, StoredUser
from interval_jobs.adapters.postgres import PostgresAi, PostgresStore
from interval_jobs.ports import (
    AiLedger,
    DuplicateInviteCode,
    FeedEntry,
    MomentRow,
    RightsViolation,
    Section,
    SectionRow,
    SourceSettings,
    Store,
    Usage,
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
            "update source set moments_enabled = true where id = %s", (source_id,)
        )

    def disable_moments(self, source_id: int) -> None:
        self.conn.execute(
            "update source set moments_enabled = false where id = %s", (source_id,)
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
    assert s.items.sections(item) == [SectionRow("B", None, 7), SectionRow("C", "c", 9)]


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
