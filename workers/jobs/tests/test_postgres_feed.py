"""Postgres per-user feeds (CACHE-1, P1-W4-S04): the *_visible views, their gate,
cascades, and the per-user lock."""

import os
import threading
import time
from datetime import UTC, datetime
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql

from interval_db.generated import BreakLength
from interval_jobs.adapters.postgres import PostgresStore
from interval_jobs.ports import Arm, Breakdown, NoteKey, RankedEntry


def add_item(
    conn: psycopg.Connection,
    source_id: int,
    guid: str,
    published: datetime,
    sections: int,
) -> int:
    row = conn.execute(
        "insert into content_item "
        "(source_id, guid, canonical_url, title, published_at) "
        "values (%s, %s, %s, %s, %s) returning id",
        (
            source_id,
            guid,
            f"https://feed.example.test/{guid}",
            f"Article {guid}",
            published,
        ),
    ).fetchone()
    assert row is not None
    item_id: int = row[0]
    for ordinal in range(sections):
        conn.execute(
            "insert into moment "
            "(content_item_id, ordinal, title, estimated_minutes, link, link_type) "
            "values (%s, %s, %s, 1, %s, 'page_top')",
            (
                item_id,
                ordinal,
                f"{guid} s{ordinal}",
                f"https://feed.example.test/{guid}",
            ),
        )
    return item_id


def source(conn: psycopg.Connection, name: str) -> int:
    source_id = PostgresStore(conn).sources.upsert(
        name=name,
        feed_url=f"https://feed.example.test/{name}.xml",
        rights_profile="full_text_internal",
        homepage=None,
    )
    conn.execute(
        "update source set moments_seeded = true, moments_enabled = true where id = %s",
        (source_id,),
    )
    return source_id


def user(conn: psycopg.Connection) -> str:
    user_id = f"feedtest-{uuid4().hex[:8]}"
    row = conn.execute(
        "insert into invite_code (code, beta_group, max_uses, expires_at) "
        "values (%s, 'student', 1, now() + interval '1 day') returning id",
        (f"FEEDTEST{uuid4().hex[:8].upper()}",),
    ).fetchone()
    assert row is not None
    conn.execute(
        "insert into app_user (id, name, email, beta_group, invite_code_id) "
        "values (%s, 'n', %s, 'student', %s)",
        (user_id, f"{user_id}@example.test", row[0]),
    )
    return user_id


def moments_of(conn: psycopg.Connection, item_id: int) -> list[int]:
    rows = conn.execute(
        "select id from moment where content_item_id = %s order by ordinal", (item_id,)
    ).fetchall()
    return [r[0] for r in rows]


def give(
    conn: psycopg.Connection,
    user_id: str,
    moment_ids: list[int],
    others: dict[BreakLength, list[int]] | None = None,
) -> None:
    by_chip: dict[BreakLength, list[int]] = {"3-8": moment_ids, **(others or {})}
    item_of = dict(
        conn.execute(
            "select id, content_item_id from moment where id = any(%s)",
            ([m for ids in by_chip.values() for m in ids],),
        ).fetchall()
    )
    PostgresStore(conn).feed.replace_user(
        user_id,
        {
            chip: [RankedEntry(item_of[m], m, "topic_match", None) for m in ids]
            for chip, ids in by_chip.items()
        },
        datetime.now(UTC),
    )


def visible(
    conn: psycopg.Connection, user_id: str, chip: BreakLength = "3-8"
) -> list[tuple[str, int, int]]:
    return conn.execute(
        "select section_title, section_number, section_count from user_feed_visible "
        "where user_id = %s and chip = %s order by rank",
        (user_id, chip),
    ).fetchall()


def test_a_user_sees_their_own_feed_in_rank_order(conn: psycopg.Connection) -> None:
    src = source(conn, "feedtest-a")
    item = add_item(conn, src, "one", datetime(2026, 10, 1, tzinfo=UTC), 2)
    first, second = moments_of(conn, item)
    me, other = user(conn), user(conn)
    give(conn, me, [second, first])
    give(conn, other, [first])
    assert visible(conn, me) == [("one s1", 2, 2), ("one s0", 1, 2)]
    assert visible(conn, other) == [("one s0", 1, 2)]


def test_each_chip_is_its_own_feed(conn: psycopg.Connection) -> None:
    src = source(conn, "feedtest-f")
    item = add_item(conn, src, "one", datetime(2026, 10, 1, tzinfo=UTC), 2)
    first, second = moments_of(conn, item)
    me = user(conn)
    give(conn, me, [first, second], {"1-3": [second], "8-15": []})
    assert visible(conn, me, "3-8") == [("one s0", 1, 2), ("one s1", 2, 2)]
    assert visible(conn, me, "1-3") == [("one s1", 2, 2)]
    assert visible(conn, me, "8-15") == []


def test_switching_moments_off_cascades_to_every_feed(conn: psycopg.Connection) -> None:
    src = source(conn, "feedtest-c")
    item = add_item(conn, src, "one", datetime(2026, 10, 1, tzinfo=UTC), 2)
    me = user(conn)
    moments = moments_of(conn, item)
    give(conn, me, moments)
    PostgresStore(conn).feed.replace_starter(
        "databases",
        "beginner",
        "3-8",
        [RankedEntry(item, m, "quality", None) for m in moments],
    )
    conn.execute(
        "update source set moments_seeded = false, moments_enabled = false "
        "where id = %s",
        (src,),
    )
    # No recompute: the purge trigger deletes the moments and the entries cascade.
    assert visible(conn, me) == []
    # This test's moments only: the shared database may hold real starter feeds.
    left = conn.execute(
        "select count(*) from starter_feed_entry where moment_id = any(%s)",
        (moments,),
    ).fetchone()
    assert left == (0,)


def test_section_count_covers_moments_left_out_of_the_feed(
    conn: psycopg.Connection,
) -> None:
    src = source(conn, "feedtest-e")
    item = add_item(conn, src, "one", datetime(2026, 10, 1, tzinfo=UTC), 3)
    me = user(conn)
    give(conn, me, moments_of(conn, item)[1:2])
    assert visible(conn, me) == [("one s1", 2, 3)]


@pytest.mark.parametrize(
    "change",
    [
        # The admin switch: moments_enabled follows it (P1-W3-S06).
        {"moments_switched_off": True, "moments_enabled": False},
        {"rights_profile": "excerpt"},
        {"rights_profile": "metadata_only"},
    ],
)
def test_views_hide_stale_entries_when_the_source_no_longer_allows_moments(
    conn: psycopg.Connection, change: dict[str, object]
) -> None:
    src = source(conn, "feedtest-d")
    item = add_item(conn, src, "one", datetime(2026, 10, 1, tzinfo=UTC), 1)
    me = user(conn)
    give(conn, me, moments_of(conn, item))
    PostgresStore(conn).feed.replace_starter(
        "databases",
        "advanced",
        "3-8",
        [RankedEntry(item, m, "quality", None) for m in moments_of(conn, item)],
    )
    # Skip triggers for this transaction only, to leave stale feed entries behind.
    conn.execute("set local session_replication_role = replica")
    conn.execute(
        sql.SQL("update source set {} where id = %s").format(
            sql.SQL(", ").join(
                sql.SQL("{} = %s").format(sql.Identifier(column)) for column in change
            )
        ),
        (*change.values(), src),
    )
    conn.execute("set local session_replication_role = origin")
    assert visible(conn, me) == []
    starter = conn.execute(
        "select count(*) from starter_feed_visible where source_name = 'feedtest-d'"
    ).fetchone()
    assert starter == (0,)


def test_two_recomputes_of_one_user_wait_for_each_other(
    conn: psycopg.Connection,
) -> None:
    url = os.environ["DATABASE_URL"]
    with psycopg.connect(url) as setup:
        me = user(setup)
        setup.commit()
    try:
        with psycopg.connect(url) as first, psycopg.connect(url) as second:
            # Inside an open transaction, as in the worker's unit of work: the lock is
            # held until that commits.
            first.execute("select 1")
            give(first, me, [])
            result: list[BaseException | None] = []

            def run_second() -> None:
                try:
                    give(second, me, [])
                    second.commit()
                    result.append(None)
                except BaseException as error:
                    result.append(error)

            worker = threading.Thread(target=run_second)
            worker.start()
            time.sleep(0.3)
            assert result == []  # blocked on the per-user advisory lock
            first.commit()
            worker.join(timeout=5)
            assert result == [None]
    finally:
        with psycopg.connect(url) as cleanup:
            cleanup.execute("delete from app_user where id = %s", (me,))


def test_a_whole_article_shows_title_and_link_from_any_profile(
    conn: psycopg.Connection,
) -> None:
    # Q-P1-39: a metadata-only article has no length; its card links to the page.
    src = source(conn, "feedtest-g")
    conn.execute(
        "update source set rights_profile = 'metadata_only', moments_seeded = false, "
        "moments_enabled = false where id = %s",
        (src,),
    )
    listed = add_item(conn, src, "listed", datetime(2026, 10, 1, tzinfo=UTC), 0)
    full = source(conn, "feedtest-h")
    counted = add_item(conn, full, "counted", datetime(2026, 10, 2, tzinfo=UTC), 1)
    conn.execute(
        "insert into content_item_section "
        "(content_item_id, ordinal, heading, level, anchor_id, word_count) "
        "values (%s, 0, null, null, null, 700)",
        (counted,),
    )
    me = user(conn)
    PostgresStore(conn).feed.replace_user(
        me,
        {
            "8-15": [
                RankedEntry(listed, None, "topic_match", None),
                RankedEntry(counted, None, "time_fit", None),
            ]
        },
        datetime.now(UTC),
    )
    rows = conn.execute(
        "select kind, content_item_id, moment_id, section_title, estimated_minutes, "
        "link from user_feed_visible where user_id = %s and chip = '8-15' "
        "order by rank",
        (me,),
    ).fetchall()
    assert rows == [
        ("article", listed, None, None, None, "https://feed.example.test/listed"),
        # 700 words at 230 a minute, rounded up.
        ("article", counted, None, None, 4, "https://feed.example.test/counted"),
    ]


def test_an_entry_cannot_pair_a_moment_with_another_items_title(
    conn: psycopg.Connection,
) -> None:
    # The view takes the title, source and rights gate from the entry's item; the
    # moment must belong to it, or one item's link would show under another's title.
    src = source(conn, "feedtest-i")
    one = add_item(conn, src, "one", datetime(2026, 10, 1, tzinfo=UTC), 1)
    other = add_item(conn, src, "other", datetime(2026, 10, 2, tzinfo=UTC), 1)
    me = user(conn)
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        PostgresStore(conn).feed.replace_user(
            me,
            {"3-8": [RankedEntry(other, moments_of(conn, one)[0], "quality", None)]},
            datetime.now(UTC),
        )


def test_a_card_shows_its_template_note_unlabelled(
    conn: psycopg.Connection,
) -> None:
    src = source(conn, "feedtest-j")
    item = add_item(conn, src, "noted", datetime(2026, 10, 1, tzinfo=UTC), 2)
    store = PostgresStore(conn)
    key = NoteKey(item, "fresh", "beginner", "fresh-1:")
    note_id = store.notes.ensure_all({key: "New this week."})[key]
    me = user(conn)
    noted, plain = moments_of(conn, item)
    store.feed.replace_user(
        me,
        {
            "3-8": [
                RankedEntry(item, noted, "freshness", note_id),
                RankedEntry(item, plain, "quality", None),
            ]
        },
        datetime.now(UTC),
    )

    def shown() -> list[tuple[str | None, bool]]:
        return conn.execute(
            "select note_text, note_ai from user_feed_visible where user_id = %s "
            "order by rank",
            (me,),
        ).fetchall()

    # The app's own words (ADR-0025): no model, no AI label.
    assert shown() == [("New this week.", False), (None, False)]
    # A note goes with its item (it cites it, AI-3).
    conn.execute("delete from content_item where id = %s", (item,))
    gone = conn.execute(
        "select count(*) from feed_note where id = %s", (note_id,)
    ).fetchone()
    assert gone == (0,)


def test_two_recomputes_writing_one_note_agree_on_it(
    conn: psycopg.Connection,
) -> None:
    # The second waits for the first's uncommitted note, then reads it: one note.
    url = os.environ["DATABASE_URL"]
    with psycopg.connect(url) as setup:
        src = source(setup, f"feedtest-k-{uuid4().hex[:6]}")
        item = add_item(setup, src, "shared", datetime(2026, 10, 1, tzinfo=UTC), 1)
        setup.commit()
    key = NoteKey(item, "freshness", "beginner", "")
    with psycopg.connect(url) as first, psycopg.connect(url) as second:
        mine = PostgresStore(first).notes.ensure_all({key: "New this week."})[key]
        theirs: list[int] = []

        def run_second() -> None:
            theirs.append(PostgresStore(second).notes.ensure_all({key: "other"})[key])
            second.commit()

        thread = threading.Thread(target=run_second)
        thread.start()
        time.sleep(0.3)
        assert theirs == []  # waiting on the first's uncommitted row
        first.commit()
        thread.join(timeout=10)
        assert theirs == [mine]
    with psycopg.connect(url) as cleanup:
        cleanup.execute("delete from content_item where id = %s", (item,))
        cleanup.execute("delete from source where id = %s", (src,))


def test_an_explored_entry_is_stored_with_its_arm(conn: psycopg.Connection) -> None:
    src = source(conn, "feedtest-l")
    item = add_item(conn, src, "explored", datetime(2026, 10, 1, tzinfo=UTC), 1)
    (moment,) = moments_of(conn, item)
    me = user(conn)
    PostgresStore(conn).feed.replace_user(
        me,
        {"3-8": [RankedEntry(item, moment, "quality", None, Arm("topic", "backend"))]},
        datetime.now(UTC),
    )
    row = conn.execute(
        "select explore_kind, explore_arm from user_feed_entry where user_id = %s",
        (me,),
    ).fetchone()
    assert row == ("topic", "backend")


def test_an_entry_keeps_its_score_breakdown_for_inspection(
    conn: psycopg.Connection,
) -> None:
    src = source(conn, "feedtest-m")
    item = add_item(conn, src, "inspected", datetime(2026, 10, 1, tzinfo=UTC), 2)
    scored, plain = moments_of(conn, item)
    me = user(conn)
    parts = Breakdown(
        values={"topic_match": 1.0, "quality": 0.5},
        weights={"topic_match": 1.0, "quality": 0.4},
        weighted={"topic_match": 1.0, "quality": 0.2},
        penalty=0.25,
    )
    PostgresStore(conn).feed.replace_user(
        me,
        {
            "3-8": [
                RankedEntry(item, scored, "topic_match", None, None, parts),
                RankedEntry(item, plain, "quality", None),
            ]
        },
        datetime.now(UTC),
    )
    rows = conn.execute(
        "select score_parts from user_feed_entry where user_id = %s order by rank",
        (me,),
    ).fetchall()
    assert rows == [
        (
            {
                "values": {"topic_match": 1.0, "quality": 0.5},
                "weights": {"topic_match": 1.0, "quality": 0.4},
                "weighted": {"topic_match": 1.0, "quality": 0.2},
                "penalty": 0.25,
            },
        ),
        (None,),
    ]


def test_a_broken_link_leaves_every_feed_at_once(conn: psycopg.Connection) -> None:
    src = source(conn, "feedtest-n")
    item = add_item(conn, src, "broken", datetime(2026, 10, 1, tzinfo=UTC), 1)
    me = user(conn)
    give(conn, me, moments_of(conn, item))
    PostgresStore(conn).feed.replace_starter(
        "databases",
        "advanced",
        "3-8",
        [RankedEntry(item, m, "quality", None) for m in moments_of(conn, item)],
    )
    assert visible(conn, me) != []
    PostgresStore(conn).items.set_link_broken(item, datetime.now(UTC))
    assert visible(conn, me) == []
    starter = conn.execute(
        "select count(*) from starter_feed_visible where source_name = 'feedtest-n'"
    ).fetchone()
    assert starter == (0,)


def test_the_views_say_whether_an_entry_can_be_framed(conn: psycopg.Connection) -> None:
    # ADR-0018: the web opens a card in-app only when its page allows framing.
    src = source(conn, "feedtest-o")
    item = add_item(conn, src, "framed", datetime(2026, 10, 1, tzinfo=UTC), 1)
    me = user(conn)
    give(conn, me, moments_of(conn, item))
    store = PostgresStore(conn)

    def framed() -> object:
        row = conn.execute(
            "select frameable from user_feed_visible where user_id = %s", (me,)
        ).fetchone()
        assert row is not None
        return row[0]

    assert framed() is None  # not known yet
    store.items.set_frameable(item, True)
    assert framed() is True
    store.items.set_frameable(item, False)
    assert framed() is False
