"""Week 1 vertical path through the real adapters (Postgres, httpx, trafilatura):
feed -> ingest -> moments -> a user's precomputed feed -> card rows."""

from datetime import UTC, datetime
from uuid import uuid4

import psycopg

from interval_jobs.adapters.http_fetcher import HttpxFetcher
from interval_jobs.adapters.polite_fetcher import PoliteFetcher
from interval_jobs.adapters.postgres import PostgresStore
from interval_jobs.adapters.trafilatura_extractor import TrafilaturaExtractor
from interval_jobs.ingest.one import ingest_one
from interval_jobs.ports import RankedMoment

from .support import ARTICLE_URL, FEED_URL, mock_web_client, public


def ingest(conn: psycopg.Connection, article: str) -> None:
    store = PostgresStore(conn)
    source_id = store.sources.upsert(
        name="seg-test",
        feed_url=FEED_URL,
        rights_profile="full_text_internal",
        homepage=None,
    )
    conn.execute(
        "update source set moments_seeded = true, moments_enabled = true where id = %s",
        (source_id,),
    )
    with mock_web_client(article) as http:
        fetcher = PoliteFetcher(HttpxFetcher(http, public), sleep=lambda _s: None)
        ingest_one(store, fetcher, TrafilaturaExtractor(), source_id)


def test_one_feed_becomes_moment_cards_without_source_text(
    conn: psycopg.Connection,
) -> None:
    ingest(conn, "article_long.html")
    # The ranking stage's output, written as the recompute stage does (P1-W4-S04).
    user_id = f"vertical-{uuid4().hex[:8]}"
    code = conn.execute(
        "insert into invite_code (code, beta_group, max_uses, expires_at) "
        "values (%s, 'student', 1, now() + interval '1 day') returning id",
        (f"VERTICAL{uuid4().hex[:8].upper()}",),
    ).fetchone()
    assert code is not None
    conn.execute(
        "insert into app_user (id, name, email, beta_group, invite_code_id) "
        "values (%s, 'n', %s, 'student', %s)",
        (user_id, f"{user_id}@example.test", code[0]),
    )
    moments = conn.execute(
        "select m.id from moment m join content_item ci on ci.id = m.content_item_id "
        "join source s on s.id = ci.source_id where s.name = 'seg-test' "
        "order by m.ordinal"
    ).fetchall()
    PostgresStore(conn).feed.replace_user(
        user_id,
        {"3-8": [RankedMoment(r[0], "topic_match") for r in moments]},
        datetime.now(UTC),
    )

    cards = conn.execute(
        """
        select section_title, section_number, section_count, estimated_minutes, link,
               article_title, author, source_name
        from user_feed_visible where user_id = %s order by rank
        """,
        (user_id,),
    ).fetchall()

    title = "How our write-ahead log works"
    assert cards == [
        (title, 1, 3, 3, ARTICLE_URL, title, "Alex Author", "seg-test"),
        ("Alpha", 2, 3, 3, f"{ARTICLE_URL}#alpha", title, "Alex Author", "seg-test"),
        (
            "Beta part",
            3,
            3,
            3,
            f"{ARTICLE_URL}#:~:text=Beta%20part",
            title,
            "Alex Author",
            "seg-test",
        ),
    ]
    # An allowlist: any new column (e.g. a summary) must be added here on purpose.
    card_columns = {
        "rank",
        "moment_id",
        "section_title",
        "section_number",
        "section_count",
        "estimated_minutes",
        "link",
        "article_title",
        "author",
        "source_name",
    }
    for view, keys in (
        ("user_feed_visible", {"user_id", "chip"}),
        ("starter_feed_visible", {"topic", "level", "chip"}),
    ):
        columns = {
            row[0]
            for row in conn.execute(
                "select column_name from information_schema.columns "
                "where table_name = %s",
                (view,),
            ).fetchall()
        }
        assert columns == card_columns | keys, view
