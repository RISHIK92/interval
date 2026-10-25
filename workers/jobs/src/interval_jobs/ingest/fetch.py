"""Guarded HTTP fetch for feeds and articles (owner rules, 2026-10-25).

http(s) only; every hop, including redirects, must resolve to public addresses only;
bodies over MAX_BYTES are refused; the content type must match what the caller expects.
Name resolution here and the later connect are separate lookups (DNS rebinding is not
covered); the AWS deployment adds network-level egress rules.
"""

import ipaddress
import socket
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urljoin, urlsplit

import httpx

type Kind = Literal["feed", "article"]
type Resolver = Callable[[str], list[str]]

MAX_BYTES = 5 * 1024 * 1024
MAX_REDIRECTS = 5
TIMEOUT_S = 10.0

CONTENT_TYPES: dict[Kind, frozenset[str]] = {
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
}


class FetchError(Exception):
    pass


@dataclass(frozen=True)
class Fetched:
    url: str  # final URL after redirects
    body: bytes
    encoding: str | None


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


def fetch(
    http: httpx.Client, url: str, kind: Kind, resolve: Resolver = resolve_host
) -> Fetched:
    for _ in range(MAX_REDIRECTS + 1):
        _check_url(url, resolve)
        with http.stream(
            "GET", url, timeout=TIMEOUT_S, follow_redirects=False
        ) as response:
            if response.is_redirect:
                location = response.headers.get("location")
                if not location:
                    raise FetchError(f"redirect without location from {url}")
                url = urljoin(url, location)
                continue
            response.raise_for_status()
            media_type = response.headers.get("content-type", "").split(";")[0].strip()
            if media_type.lower() not in CONTENT_TYPES[kind]:
                raise FetchError(
                    f"unexpected content type {media_type!r} for {kind} {url}"
                )
            body = bytearray()
            for chunk in response.iter_bytes():
                body += chunk
                if len(body) > MAX_BYTES:
                    raise FetchError(f"{kind} {url} is larger than {MAX_BYTES} bytes")
            return Fetched(
                url=url, body=bytes(body), encoding=response.charset_encoding
            )
    raise FetchError(f"more than {MAX_REDIRECTS} redirects from {url}")
