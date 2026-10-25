import httpx
import psycopg
import pytest

from interval_db.generated import RightsProfile
from interval_jobs.ingest.one import ingest_one
from interval_jobs.sources import upsert_source

from .conftest import fixture_bytes

FEED_URL = "https://blog.example.test/feed.atom"


def public(_host: str) -> list[str]:
    return ["93.184.216.34"]


ARTICLE_URL = "https://blog.example.test/wal"


class FakeWeb:
    def __init__(self, feed_status: int = 200) -> None:
        self.requested: list[str] = []
        self.feed_status = feed_status

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.requested.append(url)
        if url == FEED_URL:
            return httpx.Response(
                self.feed_status,
                headers={"content-type": "application/atom+xml"},
                content=fixture_bytes("atom.xml"),
            )
        if url == ARTICLE_URL:
            return httpx.Response(
                200,
                headers={"content-type": "text/html; charset=utf-8"},
                content=fixture_bytes("article.html"),
            )
        return httpx.Response(404)

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self.handler))


def source(conn: psycopg.Connection, profile: RightsProfile) -> int:
    return upsert_source(
        conn,
        name=f"test-{profile}",
        feed_url=FEED_URL,
        rights_profile=profile,
        homepage=None,
    )


def counts(conn: psycopg.Connection, source_id: int) -> tuple[int, int]:
    row = conn.execute(
        """
        select count(distinct ci.id), count(pt.content_item_id)
        from content_item ci
        left join content_item_private_text pt on pt.content_item_id = ci.id
        where ci.source_id = %s
        """,
        (source_id,),
    ).fetchone()
    assert row is not None
    return row[0], row[1]


def test_metadata_only_stores_metadata_and_summary_and_never_fetches_the_article(
    conn: psycopg.Connection,
) -> None:
    web = FakeWeb()
    source_id = source(conn, "metadata_only")
    with web.client() as http:
        ingest_one(conn, http, source_id, public)

    row = conn.execute(
        "select title, author, canonical_url, feed_summary, excerpt "
        "from content_item where source_id = %s",
        (source_id,),
    ).fetchone()
    assert row == (
        "How our write-ahead log works",
        "Alex Author",
        ARTICLE_URL,
        "A short tour of the write-ahead log.",
        None,
    )
    assert counts(conn, source_id) == (1, 0)
    assert ARTICLE_URL not in web.requested


def test_excerpt_stores_at_most_300_characters_and_no_full_text(
    conn: psycopg.Connection,
) -> None:
    source_id = source(conn, "excerpt")
    with FakeWeb().client() as http:
        ingest_one(conn, http, source_id, public)

    row = conn.execute(
        "select excerpt from content_item where source_id = %s", (source_id,)
    ).fetchone()
    assert row is not None
    excerpt: str = row[0]
    assert 0 < len(excerpt) <= 300
    assert counts(conn, source_id) == (1, 0)


def test_full_text_internal_stores_extracted_text_privately(
    conn: psycopg.Connection,
) -> None:
    source_id = source(conn, "full_text_internal")
    with FakeWeb().client() as http:
        ingest_one(conn, http, source_id, public)

    row = conn.execute(
        """
        select pt.text, ci.excerpt from content_item_private_text pt
        join content_item ci on ci.id = pt.content_item_id where ci.source_id = %s
        """,
        (source_id,),
    ).fetchone()
    assert row is not None
    assert "recovery replays the log" in row[0]
    assert row[1] is None


def test_running_twice_stores_one_item(conn: psycopg.Connection) -> None:
    source_id = source(conn, "full_text_internal")
    with FakeWeb().client() as http:
        ingest_one(conn, http, source_id, public)
        ingest_one(conn, http, source_id, public)

    assert counts(conn, source_id) == (1, 1)


def test_feed_error_raises_and_stores_nothing(conn: psycopg.Connection) -> None:
    source_id = source(conn, "full_text_internal")
    with (
        FakeWeb(feed_status=500).client() as http,
        pytest.raises(httpx.HTTPStatusError),
    ):
        ingest_one(conn, http, source_id, public)

    assert counts(conn, source_id) == (0, 0)


@pytest.mark.parametrize(
    ("before", "after", "expected"),
    [
        ("full_text_internal", "metadata_only", (1, 0)),
        ("full_text_internal", "excerpt", (1, 0)),
        ("excerpt", "metadata_only", (1, 0)),
    ],
)
def test_lowering_the_profile_removes_text_and_reingest_still_works(
    conn: psycopg.Connection,
    before: RightsProfile,
    after: RightsProfile,
    expected: tuple[int, int],
) -> None:
    source_id = source(conn, before)
    with FakeWeb().client() as http:
        ingest_one(conn, http, source_id, public)
        upsert_source(
            conn,
            name=f"test-{before}",
            feed_url=FEED_URL,
            rights_profile=after,
            homepage=None,
        )
        assert counts(conn, source_id) == expected
        ingest_one(conn, http, source_id, public)

    assert counts(conn, source_id) == expected
    excerpt = conn.execute(
        "select excerpt from content_item where source_id = %s", (source_id,)
    ).fetchone()
    assert excerpt is not None
    assert (excerpt[0] is not None) is (after == "excerpt")
