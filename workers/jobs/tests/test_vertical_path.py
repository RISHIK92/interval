"""Week 1 vertical path through the real adapters (Postgres, httpx, trafilatura):
feed -> ingest -> moments -> precomputed feed -> card rows."""

import psycopg

from interval_jobs.adapters.http_fetcher import HttpxFetcher
from interval_jobs.adapters.polite_fetcher import PoliteFetcher
from interval_jobs.adapters.postgres import PostgresStore
from interval_jobs.adapters.trafilatura_extractor import TrafilaturaExtractor
from interval_jobs.ingest.one import ingest_one

from .support import ARTICLE_URL, FEED_URL, mock_web_client, public


def ingest(conn: psycopg.Connection, article: str) -> None:
    store = PostgresStore(conn)
    source_id = store.sources.upsert(
        name="seg-test",
        feed_url=FEED_URL,
        rights_profile="full_text_internal",
        homepage=None,
    )
    conn.execute("update source set moments_enabled = true where id = %s", (source_id,))
    with mock_web_client(article) as http:
        fetcher = PoliteFetcher(HttpxFetcher(http, public), sleep=lambda _s: None)
        ingest_one(store, fetcher, TrafilaturaExtractor(), source_id)


def test_one_feed_becomes_moment_cards_without_source_text(
    conn: psycopg.Connection,
) -> None:
    ingest(conn, "article_long.html")

    cards = conn.execute(
        """
        select section_title, section_number, section_count, estimated_minutes, link,
               article_title, author, source_name
        from feed_visible where source_name = 'seg-test' order by rank
        """
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
    columns = {
        row[0]
        for row in conn.execute(
            "select column_name from information_schema.columns "
            "where table_name = 'feed_visible'"
        ).fetchall()
    }
    # An allowlist: any new column (e.g. a summary) must be added here on purpose.
    assert columns == {
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
