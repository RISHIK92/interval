"""Shared test helpers: fake web pages for logic tests, a mock web for real adapters."""

import httpx

from interval_db.generated import RightsProfile
from interval_jobs.adapters.memory import FakeFetcher, InMemoryStore
from interval_jobs.adapters.trafilatura_extractor import TrafilaturaExtractor
from interval_jobs.ingest.one import ingest_one
from interval_jobs.ports import Fetched, FetchError

from .conftest import fixture_bytes

FEED_URL = "https://seg.example.test/feed.atom"
ARTICLE_URL = "https://blog.example.test/wal"


def fake_web(article: str, feed_error: FetchError | None = None) -> FakeFetcher:
    feed: Fetched | FetchError = feed_error or Fetched(
        FEED_URL, fixture_bytes("atom.xml"), "utf-8"
    )
    return FakeFetcher(
        {
            FEED_URL: feed,
            ARTICLE_URL: Fetched(ARTICLE_URL, fixture_bytes(article), "utf-8"),
        }
    )


def ingest_fake(
    article: str,
    profile: RightsProfile = "full_text_internal",
    moments_enabled: bool = True,
    store: InMemoryStore | None = None,
) -> tuple[InMemoryStore, int, int]:
    """Ingest the fixture feed into an in-memory store; returns store, source, item."""
    store = store or InMemoryStore()
    source_id = store.sources.upsert(
        name="seg-test", feed_url=FEED_URL, rights_profile=profile, homepage=None
    )
    store.sources.set_moments_enabled(source_id, moments_enabled)
    result = ingest_one(store, fake_web(article), TrafilaturaExtractor(), source_id)
    return store, source_id, result.content_item_id


def public(_host: str) -> list[str]:
    return ["93.184.216.34"]


def mock_web_client(article: str) -> httpx.Client:
    """An httpx client serving the fixture feed and article, for the real adapters."""

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
