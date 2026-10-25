"""Mock-web ingest helpers shared by the segmentation, feed and end-to-end tests."""

import httpx
import psycopg

from interval_db.generated import RightsProfile
from interval_jobs.ingest.one import ingest_one
from interval_jobs.sources import upsert_source

from .conftest import fixture_bytes

FEED_URL = "https://seg.example.test/feed.atom"
ARTICLE_URL = "https://blog.example.test/wal"


def public(_host: str) -> list[str]:
    return ["93.184.216.34"]


def web(article: str) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == FEED_URL:
            return httpx.Response(
                200,
                headers={"content-type": "application/atom+xml"},
                content=fixture_bytes("atom.xml"),
            )
        return httpx.Response(
            200, headers={"content-type": "text/html"}, content=fixture_bytes(article)
        )

    return httpx.Client(transport=httpx.MockTransport(handler))


def ingest(
    conn: psycopg.Connection,
    article: str,
    profile: RightsProfile = "full_text_internal",
    moments_enabled: bool = True,
) -> tuple[int, int]:
    source_id = upsert_source(
        conn, name="seg-test", feed_url=FEED_URL, rights_profile=profile, homepage=None
    )
    conn.execute(
        "update source set moments_enabled = %s where id = %s",
        (moments_enabled, source_id),
    )
    with web(article) as http:
        item_id = ingest_one(conn, http, source_id, public).content_item_id
    return source_id, item_id
