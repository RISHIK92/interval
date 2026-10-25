"""Store contract (ADR-0012): the same repository cases against the in-memory fake and
the Postgres adapter, so logic tested on the fake behaves the same on the database.

Ports have no read methods that only tests need; each store gets a test-side probe that
inspects its state (internal fields for the fake, SQL for Postgres).
"""

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

import psycopg
import pytest

from interval_db.generated import RightsProfile
from interval_jobs.adapters.memory import InMemoryStore
from interval_jobs.adapters.postgres import PostgresStore
from interval_jobs.ports import (
    DuplicateInviteCode,
    FeedEntry,
    MomentRow,
    RightsViolation,
    Section,
    SectionRow,
    Store,
)


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


@dataclass
class MemoryProbe:
    s: InMemoryStore

    def enable_moments(self, source_id: int) -> None:
        self.s.sources.set_moments_enabled(source_id, True)

    def disable_moments(self, source_id: int) -> None:
        self.s.sources.set_moments_enabled(source_id, False)

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
