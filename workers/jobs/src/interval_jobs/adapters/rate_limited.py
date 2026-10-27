"""Waiting out a model provider's 429 (owner, 2026-10-27). Groq caps tokens per minute
and OpenRouter's free pools are often busy; a short wait usually clears it, so a call
tries a few times before failing. Each wait is logged (LOAD-5: observable)."""

import time
from collections.abc import Callable, Mapping

import httpx

from interval_jobs import log

# Without a usable Retry-After, wait these long between tries; never past the cap.
WAITS_S = (5.0, 15.0, 45.0)
MAX_WAIT_S = 60.0


def _retry_after(response: httpx.Response) -> float | None:
    try:
        return float(response.headers.get("retry-after", ""))
    except ValueError:
        return None


def post_until_allowed(
    http: httpx.Client,
    url: str,
    *,
    json: object,
    headers: Mapping[str, str],
    timeout: float,
    sleep: Callable[[float], None] = time.sleep,
) -> httpx.Response:
    for wait in (*WAITS_S, None):
        response = http.post(url, json=json, headers=headers, timeout=timeout)
        if response.status_code != 429 or wait is None:
            return response
        pause = min(_retry_after(response) or wait, MAX_WAIT_S)
        log.warn("ai: rate limited, waiting", url=url, seconds=pause)
        sleep(pause)
    raise AssertionError("unreachable: the last try always returns")
