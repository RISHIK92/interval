"""Whether a publisher's page may be framed in Interval's reader (ADR-0018)."""

import httpx
import pytest

from interval_jobs.frameable import frameable


@pytest.mark.parametrize(
    "headers",
    [
        {"X-Frame-Options": "DENY"},
        {"x-frame-options": "SAMEORIGIN"},
        {"X-Frame-Options": "ALLOW-FROM https://slack.com/"},
        {"Content-Security-Policy": "default-src 'self'; frame-ancestors 'self'"},
        {"content-security-policy": "frame-ancestors https://example.test"},
        {"Content-Security-Policy": "frame-ancestors 'none'"},
        {"Content-Security-Policy": "Frame-Ancestors 'none'"},  # names are any case
        # An unknown value: refused, erring toward the browser fallback.
        {"X-Frame-Options": "ALLOWALL"},
    ],
)
def test_a_page_that_names_who_may_frame_it_refuses_interval(
    headers: dict[str, str],
) -> None:
    assert frameable(headers) is False


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Content-Security-Policy": "default-src 'self'; img-src *"},
        {"Content-Security-Policy": "frame-ancestors *"},
        {"Content-Type": "text/html"},
        # Report-Only policies aren't enforced by browsers.
        {"Content-Security-Policy-Report-Only": "frame-ancestors 'none'"},
    ],
)
def test_a_page_that_sets_no_framing_rule_can_be_framed(
    headers: dict[str, str],
) -> None:
    assert frameable(headers) is True


def test_every_csp_header_counts_when_a_page_sends_several() -> None:
    # httpx joins repeated headers with ", "; the second policy still restricts.
    headers = httpx.Headers(
        [
            ("Content-Security-Policy", "upgrade-insecure-requests"),
            ("Content-Security-Policy", "frame-ancestors 'self'"),
        ]
    )
    assert frameable(headers) is False
    allowed = httpx.Headers(
        [
            ("Content-Security-Policy", "upgrade-insecure-requests"),
            ("Content-Security-Policy", "frame-ancestors *"),
        ]
    )
    assert frameable(allowed) is True
