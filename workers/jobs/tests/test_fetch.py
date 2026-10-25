import httpx
import pytest

from interval_jobs.ingest.fetch import MAX_BYTES, FetchError, fetch

PUBLIC = "93.184.216.34"


def public(_host: str) -> list[str]:
    return [PUBLIC]


def client(handler: httpx.MockTransport) -> httpx.Client:
    return httpx.Client(transport=handler)


def respond(status: int = 200, **kwargs: object) -> httpx.MockTransport:
    return httpx.MockTransport(lambda _req: httpx.Response(status, **kwargs))  # type: ignore[arg-type]


def test_returns_body_final_url_and_charset() -> None:
    web = respond(
        headers={"content-type": "text/html; charset=windows-1252"}, content=b"<p>x</p>"
    )
    with client(web) as http:
        got = fetch(http, "https://a.example.test/p", "article", public)
    assert (got.url, got.body, got.encoding) == (
        "https://a.example.test/p",
        b"<p>x</p>",
        "windows-1252",
    )


@pytest.mark.parametrize(
    "url", ["file:///etc/passwd", "ftp://a.example.test/x", "javascript:x"]
)
def test_refuses_non_http_urls(url: str) -> None:
    with client(respond()) as http, pytest.raises(FetchError, match="non-http"):
        fetch(http, url, "feed", public)


@pytest.mark.parametrize("address", ["127.0.0.1", "10.0.0.5", "169.254.169.254", "::1"])
def test_refuses_private_and_metadata_addresses(address: str) -> None:
    with client(respond()) as http, pytest.raises(FetchError, match="non-public"):
        fetch(http, "https://a.example.test/feed", "feed", lambda _h: [address])


def test_checks_every_redirect_hop() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "a.example.test":
            return httpx.Response(
                302, headers={"location": "http://internal.test/meta"}
            )
        return httpx.Response(
            200, headers={"content-type": "text/xml"}, content=b"<rss/>"
        )

    def resolve(host: str) -> list[str]:
        return ["169.254.169.254"] if host == "internal.test" else [PUBLIC]

    with (
        client(httpx.MockTransport(handler)) as http,
        pytest.raises(FetchError, match="non-public"),
    ):
        fetch(http, "https://a.example.test/feed", "feed", resolve)


def test_follows_a_redirect_to_another_public_host() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "old.example.test":
            return httpx.Response(
                301, headers={"location": "https://new.example.test/feed"}
            )
        return httpx.Response(
            200, headers={"content-type": "application/rss+xml"}, content=b"<rss/>"
        )

    with client(httpx.MockTransport(handler)) as http:
        got = fetch(http, "https://old.example.test/feed", "feed", public)
    assert got.url == "https://new.example.test/feed"


def test_refuses_an_unexpected_content_type() -> None:
    web = respond(headers={"content-type": "application/pdf"}, content=b"%PDF")
    with client(web) as http, pytest.raises(FetchError, match="content type"):
        fetch(http, "https://a.example.test/p", "article", public)


def test_refuses_a_body_over_the_cap() -> None:
    web = respond(headers={"content-type": "text/html"}, content=b"x" * (MAX_BYTES + 1))
    with client(web) as http, pytest.raises(FetchError, match="larger than"):
        fetch(http, "https://a.example.test/p", "article", public)
