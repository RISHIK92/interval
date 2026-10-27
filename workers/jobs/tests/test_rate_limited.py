"""A provider's 429 is waited out a few times before the call fails (owner, 2026-10-27:
Groq's per-minute token caps and OpenRouter's busy free pools refused the evals)."""

import httpx

from interval_jobs.adapters.rate_limited import WAITS_S, post_until_allowed


def replies(*answers: httpx.Response) -> tuple[httpx.Client, list[int]]:
    queue = list(answers)
    seen: list[int] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        seen.append(1)
        return queue.pop(0)

    return httpx.Client(transport=httpx.MockTransport(handler)), seen


def post(http: httpx.Client, waits: list[float]) -> httpx.Response:
    return post_until_allowed(
        http, "https://x.test/v1", json={}, headers={}, timeout=1.0, sleep=waits.append
    )


def test_a_429_is_retried_after_the_providers_retry_after() -> None:
    http, seen = replies(
        httpx.Response(429, headers={"retry-after": "2"}),
        httpx.Response(429),
        httpx.Response(200, json={"ok": True}),
    )
    waits: list[float] = []
    assert post(http, waits).status_code == 200
    assert waits == [2.0, WAITS_S[1]]
    assert len(seen) == 3


def test_a_429_that_never_clears_is_returned_after_the_last_wait() -> None:
    http, seen = replies(*[httpx.Response(429) for _ in range(len(WAITS_S) + 1)])
    waits: list[float] = []
    assert post(http, waits).status_code == 429
    assert waits == list(WAITS_S)
    assert len(seen) == len(WAITS_S) + 1


def test_other_answers_are_not_retried() -> None:
    http, seen = replies(httpx.Response(500))
    waits: list[float] = []
    assert post(http, waits).status_code == 500
    assert waits == [] and len(seen) == 1


def test_a_long_or_odd_retry_after_is_capped_or_ignored() -> None:
    http, _ = replies(
        httpx.Response(429, headers={"retry-after": "3600"}),
        httpx.Response(429, headers={"retry-after": "soon"}),
        httpx.Response(200),
    )
    waits: list[float] = []
    post(http, waits)
    assert waits == [60.0, WAITS_S[1]]
