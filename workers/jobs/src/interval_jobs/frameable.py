"""Whether a publisher's page may be shown in Interval's in-app reader (ADR-0018).

Read from the page's own response headers, erring toward "no": X-Frame-Options with any
value refuses Interval, and so does any Content-Security-Policy whose frame-ancestors
isn't exactly the wildcard (no publisher names Interval). Browsers are looser in places
(they ignore ALLOW-FROM, and let frame-ancestors override X-Frame-Options), but a wrong
"no" only sends the card to the browser, while a wrong "yes" shows a blank frame.
Report-Only policies are not enforced, so they don't count.
"""

from collections.abc import Mapping


def frameable(headers: Mapping[str, str]) -> bool:
    lowered = {name.lower(): value for name, value in headers.items()}
    if "x-frame-options" in lowered:
        return False
    # Repeated CSP headers arrive joined by ", " (httpx); every policy is enforced.
    for policy in lowered.get("content-security-policy", "").split(","):
        for directive in policy.split(";"):
            parts = directive.split()
            if parts and parts[0].lower() == "frame-ancestors" and parts[1:] != ["*"]:
                return False
    return True


def framed_at(url: str, *, headers_allow: bool) -> bool:
    # The reader page allows frame-src https: only, so an http page can't be shown
    # in it whatever its headers say; it opens in the browser (owner, 2026-10-27).
    return headers_allow and url.startswith("https://")
