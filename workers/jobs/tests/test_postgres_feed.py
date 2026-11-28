"""Postgres per-user feeds (CACHE-1, P1-W4-S04): the *_visible views, their gate,
cascades, and the per-user lock. ADR-0058: one list of articles, with no chips."""

import os
import threading
import time
from datetime import UTC, datetime
from uuid import uuid4

import psycopg

from interval_jobs.adapters.postgres import PostgresStore
from interval_jobs.ports import Arm, Breakdown, RankedEntry


def add_item(
    conn: psycopg.Connection, source_id: int, guid: str, published: datetime
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
    return int(row[0])


def source(conn: psycopg.Connection, name: str) -> int:
    return PostgresStore(conn).sources.upsert(
        name=name,
        feed_url=f"https://feed.example.test/{name}.xml",
        rights_profile="full_text_internal",
        homepage=None,
    )


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


def give(conn: psycopg.Connection, user_id: str, item_ids: list[int]) -> None:
    PostgresStore(conn).feed.replace_user(
        user_id,
        [RankedEntry(i, "topic_match", None) for i in item_ids],
        datetime.now(UTC),
    )


def visible(conn: psycopg.Connection, user_id: str) -> list[tuple[str]]:
    return conn.execute(
        "select article_title from user_feed_visible where user_id = %s order by rank",
        (user_id,),
    ).fetchall()


def test_a_user_sees_their_own_feed_in_rank_order(conn: psycopg.Connection) -> None:
    src = source(conn, "feedtest-a")
    one = add_item(conn, src, "one", datetime(2026, 10, 1, tzinfo=UTC))
    two = add_item(conn, src, "two", datetime(2026, 10, 2, tzinfo=UTC))
    me, other = user(conn), user(conn)
    give(conn, me, [two, one])
    give(conn, other, [one])
    assert visible(conn, me) == [("Article two",), ("Article one",)]
    assert visible(conn, other) == [("Article one",)]


def test_a_recompute_replaces_the_whole_list(conn: psycopg.Connection) -> None:
    src = source(conn, "feedtest-b")
    item = add_item(conn, src, "whole", datetime(2026, 10, 1, tzinfo=UTC))
    old = add_item(conn, src, "old", datetime(2026, 9, 1, tzinfo=UTC))
    me = user(conn)
    give(conn, me, [old, item])
    give(conn, me, [item])
    rows = conn.execute(
        "select content_item_id, rank from user_feed_entry where user_id = %s",
        (me,),
    ).fetchall()
    assert [r[0] for r in rows] == [item]
    store = PostgresStore(conn)
    store.feed.replace_starter(
        "databases", "beginner", [RankedEntry(old, "quality", None)]
    )
    store.feed.replace_starter(
        "databases", "beginner", [RankedEntry(item, "quality", None)]
    )
    starter = conn.execute(
        "select content_item_id from starter_feed_entry "
        "where topic = 'databases' and level = 'beginner' "
        "and content_item_id in (%s, %s)",
        (item, old),
    ).fetchall()
    assert starter == [(item,)]


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


def test_an_article_shows_title_and_link_from_any_profile(
    conn: psycopg.Connection,
) -> None:
    # Q-P1-39: a metadata-only article has no length; its card links to the page.
    src = source(conn, "feedtest-g")
    conn.execute(
        "update source set rights_profile = 'metadata_only' where id = %s", (src,)
    )
    listed = add_item(conn, src, "listed", datetime(2026, 10, 1, tzinfo=UTC))
    full = source(conn, "feedtest-h")
    counted = add_item(conn, full, "counted", datetime(2026, 10, 2, tzinfo=UTC))
    conn.execute(
        "insert into content_item_section "
        "(content_item_id, ordinal, heading, level, anchor_id, word_count) "
        "values (%s, 0, null, null, null, 700)",
        (counted,),
    )
    me = user(conn)
    give(conn, me, [listed, counted])
    rows = conn.execute(
        "select content_item_id, estimated_minutes, link from user_feed_visible "
        "where user_id = %s order by rank",
        (me,),
    ).fetchall()
    assert rows == [
        (listed, None, "https://feed.example.test/listed"),
        # 700 words at 230 a minute, rounded up.
        (counted, 4, "https://feed.example.test/counted"),
    ]


# ADR-0027: the card's explanation, its kind and its difficulty are stored per entry and
# read through the views; a starter feed's too.
def test_a_cards_reasons_are_stored_and_shown(conn: psycopg.Connection) -> None:
    src = source(conn, "feedtest-j")
    item = add_item(conn, src, "reasoned", datetime(2026, 10, 1, tzinfo=UTC))
    plain = add_item(conn, src, "plain", datetime(2026, 10, 2, tzinfo=UTC))
    store = PostgresStore(conn)
    me = user(conn)
    store.feed.replace_user(
        me,
        [
            RankedEntry(
                item,
                "topic_match",
                "Homework for velox: Transactions.",
                reason_kinds=("project_match",),
                difficulty="intermediate",
            ),
            RankedEntry(plain, "quality", None),
        ],
        datetime.now(UTC),
    )
    assert conn.execute(
        "select reasons, reason_kinds, difficulty from user_feed_visible "
        "where user_id = %s order by rank",
        (me,),
    ).fetchall() == [
        ("Homework for velox: Transactions.", ["project_match"], "intermediate"),
        (None, [], None),
    ]
    store.feed.replace_starter(
        "databases",
        "beginner",
        [RankedEntry(item, "quality", "Worth a look.", difficulty="beginner")],
    )
    assert conn.execute(
        "select reasons, difficulty from starter_feed_visible "
        "where topic = 'databases' and level = 'beginner' and content_item_id = %s",
        (item,),
    ).fetchall() == [("Worth a look.", "beginner")]


def test_an_explored_entry_is_stored_with_its_arm(conn: psycopg.Connection) -> None:
    src = source(conn, "feedtest-l")
    item = add_item(conn, src, "explored", datetime(2026, 10, 1, tzinfo=UTC))
    me = user(conn)
    PostgresStore(conn).feed.replace_user(
        me,
        [RankedEntry(item, "quality", None, Arm("topic", "backend"))],
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
    scored = add_item(conn, src, "inspected", datetime(2026, 10, 1, tzinfo=UTC))
    plain = add_item(conn, src, "plain-m", datetime(2026, 10, 2, tzinfo=UTC))
    me = user(conn)
    parts = Breakdown(
        values={"topic_match": 1.0, "quality": 0.5},
        weights={"topic_match": 1.0, "quality": 0.4},
        weighted={"topic_match": 1.0, "quality": 0.2},
        penalty=0.25,
    )
    PostgresStore(conn).feed.replace_user(
        me,
        [
            RankedEntry(scored, "topic_match", None, None, parts),
            RankedEntry(plain, "quality", None),
        ],
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
    item = add_item(conn, src, "broken", datetime(2026, 10, 1, tzinfo=UTC))
    me = user(conn)
    give(conn, me, [item])
    PostgresStore(conn).feed.replace_starter(
        "databases", "advanced", [RankedEntry(item, "quality", None)]
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
    item = add_item(conn, src, "framed", datetime(2026, 10, 1, tzinfo=UTC))
    me = user(conn)
    give(conn, me, [item])
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
