"""Normalize (ING-1, Q-P1-08): canonical URLs and the near-duplicate fingerprint.

Canonical URL: the page's `<link rel="canonical">` when it is on the same site, else the
final URL after redirects; either way without tracking parameters, fragment or default
port. A cross-site canonical (a syndicated copy pointing at Medium, say) is ignored: it
would make the item's deep links point at someone else's page.

Near duplicates: 64-bit SimHash over word 3-shingles of the extracted text, Hamming
distance 3 or less. Only computed under full-text rights (the caller checks), and not
for text too short to tell articles apart (a paywall stub, a failed extraction).
"""

import hashlib
import re
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, urlunsplit

# Parameters that only say where a click came from.
_TRACKING = re.compile(
    r"^(utm_.*|fbclid|gclid|dclid|msclkid|yclid|igshid|mc_cid|mc_eid|_hsenc|_hsmi"
    r"|ref_src)$",
    re.IGNORECASE,
)
_DEFAULT_PORTS = {"http": 80, "https": 443}
MAX_SIMHASH_DISTANCE = 3
MIN_SHINGLES = 20


def clean_url(url: str) -> str:
    """Raises ValueError on a malformed port.

    shortcut: the fragment and any userinfo are dropped, so hash-routed sites
    (`/#!/post/1`) collapse to one URL; handle them if a seed source needs it.
    """
    parts = urlsplit(url)
    scheme = parts.scheme.lower()
    host = (parts.hostname or "").lower()
    if ":" in host:
        host = f"[{host}]"  # IPv6
    netloc = (
        host
        if parts.port in (None, _DEFAULT_PORTS.get(scheme))
        else (f"{host}:{parts.port}")
    )
    # Raw pairs, not parse_qsl/urlencode: re-encoding could change what the URL means.
    query = "&".join(
        pair
        for pair in parts.query.split("&")
        if pair and not _TRACKING.match(pair.split("=", 1)[0])
    )
    return urlunsplit((scheme, netloc, parts.path or "/", query, ""))


def _site(url: str) -> str:
    host = (urlsplit(url).hostname or "").lower()
    return host.removeprefix("www.")


class _CanonicalLink(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.href: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        rel = (values.get("rel") or "").lower().split()
        if self.href is None and tag == "link" and "canonical" in rel:
            self.href = values.get("href")


def page_canonical(page: bytes, encoding: str | None, final_url: str) -> str:
    parser = _CanonicalLink()
    parser.feed(page.decode(encoding or "utf-8", errors="replace"))
    parser.close()
    final = clean_url(final_url)
    if not parser.href:
        return final
    declared = urljoin(final_url, parser.href.strip())
    try:
        canonical = clean_url(declared)
    except ValueError:
        return final  # the page's markup is the publisher's, not ours to fail on
    same_site = _site(canonical) == _site(final)
    # Some sites name their homepage as every page's canonical.
    homepage = urlsplit(canonical).path == "/" and urlsplit(final).path != "/"
    if same_site and not homepage and urlsplit(canonical).scheme in ("http", "https"):
        return canonical
    return final


def _hash64(token: str) -> int:
    return int.from_bytes(hashlib.blake2b(token.encode(), digest_size=8).digest())


def simhash(text: str) -> int | None:
    """Signed, so it fits a Postgres bigint; None for text too short to compare."""
    words = re.findall(r"\w+", text.casefold())
    shingles = [" ".join(words[i : i + 3]) for i in range(len(words) - 2)]
    if len(shingles) < MIN_SHINGLES:
        return None
    weights = [0] * 64
    for shingle in shingles:
        value = _hash64(shingle)
        for bit in range(64):
            weights[bit] += 1 if value >> bit & 1 else -1
    unsigned = sum(1 << bit for bit in range(64) if weights[bit] > 0)
    return unsigned - (1 << 64) if unsigned >= 1 << 63 else unsigned


def near_duplicates(a: int, b: int) -> bool:
    return ((a ^ b) & ((1 << 64) - 1)).bit_count() <= MAX_SIMHASH_DISTANCE
