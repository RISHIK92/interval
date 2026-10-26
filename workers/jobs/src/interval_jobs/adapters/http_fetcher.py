"""Fetcher adapter (ADR-0012): guarded httpx fetch for feeds and articles.

Owner rules, 2026-10-25:

http(s) only; every hop, including redirects, must resolve to public addresses only;
bodies over MAX_BYTES are refused; the content type must match what the caller expects.
Name resolution here and the later connect are separate lookups (DNS rebinding is not
covered); the AWS deployment adds network-level egress rules.
"""

import ipaddress
import socket
from collections.abc import Callable
from typing import Literal
from urllib.parse import urljoin, urlsplit

import httpx

from interval_jobs.frameable import frameable
from interval_jobs.ports import (
    Fetched,
    FetchError,
    FetchKind,
    FetchStatusError,
    Validators,
)

type Resolver = Callable[[str], list[str]]
# Called with each URL just before it is requested, redirect hops included.
type OnHop = Callable[[str], None]
# robots.txt is the polite fetcher's own request, not something the pipeline asks for.
type RequestKind = FetchKind | Literal["robots"]

MAX_BYTES = 5 * 1024 * 1024
MAX_REDIRECTS = 5
TIMEOUT_S = 10.0

# None: any type (robots.txt is often served without text/plain).
CONTENT_TYPES: dict[RequestKind, frozenset[str] | None] = {
    "feed": frozenset(
        {
            "application/rss+xml",
            "application/atom+xml",
            "application/xml",
            "text/xml",
            "application/rdf+xml",
        }
    ),
    "article": frozenset({"text/html", "application/xhtml+xml"}),
    "robots": None,
}


class UnexpectedContentType(FetchError):
    """The response isn't the media type the caller asked for."""


def resolve_host(host: str) -> list[str]:
    infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    return [str(info[4][0]) for info in infos]


def _check_url(url: str, resolve: Resolver) -> None:
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise FetchError(f"refusing non-http(s) URL: {url}")
    try:
        addresses = resolve(parts.hostname)
    except OSError as error:
        raise FetchError(f"cannot resolve {parts.hostname}: {error}") from error
    if not addresses:
        raise FetchError(f"{parts.hostname} resolves to no address")
    for address in addresses:
        if not ipaddress.ip_address(address).is_global:
            raise FetchError(
                f"refusing non-public address {address} for {parts.hostname}"
            )


class HttpxFetcher:
    def __init__(self, http: httpx.Client, resolve: Resolver = resolve_host) -> None:
        self._http = http
        self._resolve = resolve

    def fetch(self, url: str, kind: FetchKind) -> Fetched:
        fetched = self.request(url, kind, {})
        if fetched is None:
            raise FetchError(f"{kind} {url}: 304 without a conditional request")
        return fetched

    def check(self, url: str, on_hop: OnHop | None = None) -> bool:
        fetched = self.request(url, "article", {}, on_hop, read_body=False)
        return fetched is not None and fetched.frameable is True

    def request(
        self,
        url: str,
        kind: RequestKind,
        headers: dict[str, str],
        on_hop: OnHop | None = None,
        read_body: bool = True,
    ) -> Fetched | None:
        """One guarded GET with extra headers; None for 304 Not Modified. Without
        `read_body`, only the status: the body is never read, nor its type checked."""
        # The port promises FetchError for every failure, so callers never see httpx.
        try:
            return _fetch(
                self._http, url, kind, self._resolve, headers, on_hop, read_body
            )
        except httpx.HTTPStatusError as error:
            raise FetchStatusError(
                f"{kind} {url}: {error}", error.response.status_code
            ) from error
        except httpx.HTTPError as error:
            raise FetchError(f"{kind} {url}: {error}") from error


def _fetch(
    http: httpx.Client,
    url: str,
    kind: RequestKind,
    resolve: Resolver,
    headers: dict[str, str],
    on_hop: OnHop | None,
    read_body: bool,
) -> Fetched | None:
    for _ in range(MAX_REDIRECTS + 1):
        _check_url(url, resolve)
        if on_hop is not None:
            on_hop(url)
        with http.stream(
            "GET", url, timeout=TIMEOUT_S, follow_redirects=False, headers=headers
        ) as response:
            if response.status_code == 304:
                return None
            if response.is_redirect:
                location = response.headers.get("location")
                if not location:
                    raise FetchError(f"redirect without location from {url}")
                url = urljoin(url, location)
                continue
            response.raise_for_status()
            # The final response's own headers decide, as the browser's frame will see.
            can_frame = frameable(response.headers)
            if not read_body:
                return Fetched(url=url, body=b"", encoding=None, frameable=can_frame)
            media_type = response.headers.get("content-type", "").split(";")[0].strip()
            expected = CONTENT_TYPES[kind]
            if expected is not None and media_type.lower() not in expected:
                raise UnexpectedContentType(
                    f"unexpected content type {media_type!r} for {kind} {url}"
                )
            body = bytearray()
            for chunk in response.iter_bytes():
                body += chunk
                if len(body) > MAX_BYTES:
                    raise FetchError(f"{kind} {url} is larger than {MAX_BYTES} bytes")
            return Fetched(
                url=url,
                body=bytes(body),
                encoding=response.charset_encoding,
                validators=_validators(response.headers),
                frameable=can_frame,
            )
    raise FetchError(f"more than {MAX_REDIRECTS} redirects from {url}")


def _validators(headers: httpx.Headers) -> Validators | None:
    etag, last_modified = headers.get("etag"), headers.get("last-modified")
    return Validators(etag, last_modified) if etag or last_modified else None
