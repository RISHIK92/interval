"""OpenRouter's Batch API (Q-P2-13, P2-W8-S05): many chat requests at half price,
submitted once and collected later. httpx's mock transport plays OpenRouter."""

import json
from collections.abc import Callable
from decimal import Decimal

import httpx
import pytest

from interval_jobs.adapters.openrouter_batches import URL, OpenRouterBatches
from interval_jobs.ports import BatchItem, BatchRequest, ModelError

REQUESTS = [
    BatchRequest("draft-7", [{"role": "user", "content": "Passage one"}]),
    BatchRequest("draft-9", [{"role": "user", "content": "Passage two"}]),
]


def completion(text: str, prompt: int, completion_: int) -> dict[str, object]:
    return {
        "object": "chat.completion",
        "choices": [{"index": 0, "message": {"role": "assistant", "content": text}}],
        "usage": {
            "prompt_tokens": prompt,
            "completion_tokens": completion_,
            "total_tokens": prompt + completion_,
        },
    }


def batch(status: str, **over: object) -> dict[str, object]:
    return {
        "id": "batch_abc",
        "object": "batch",
        "endpoint": "/v1/chat/completions",
        "model": "anthropic/claude-haiku-5.5",
        "status": status,
        "request_counts": {"total": 2, "completed": 0, "failed": 0},
        "usage": None,
        "results": None,
        "error": None,
        **over,
    }


def client(
    handler: Callable[[httpx.Request], httpx.Response],
    prices: dict[str, Decimal | None] | None = None,
) -> OpenRouterBatches:
    listed = prices or {"anthropic/claude-haiku-5.5:batch": Decimal("0.25")}
    return OpenRouterBatches(
        httpx.Client(transport=httpx.MockTransport(handler)),
        "k",
        sleep=lambda _s: None,
        output_price=lambda model: listed.get(model),
    )


def test_a_submit_sends_every_request_with_requests_last_and_returns_the_id() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(202, json=batch("validating"))

    got = client(handler).submit("anthropic/claude-haiku-5.5", REQUESTS)
    assert got == "batch_abc"
    assert str(seen[0].url) == URL
    assert seen[0].headers["authorization"] == "Bearer k"
    body = json.loads(seen[0].content)
    # The API refuses a body whose `requests` isn't its last key.
    assert list(body)[-1] == "requests"
    assert body["endpoint"] == "/v1/chat/completions"
    assert body["model"] == "anthropic/claude-haiku-5.5"
    assert [r["custom_id"] for r in body["requests"]] == ["draft-7", "draft-9"]
    first = body["requests"][0]["body"]
    assert first["model"] == "anthropic/claude-haiku-5.5"
    assert first["messages"] == [{"role": "user", "content": "Passage one"}]
    # Haiku's thinking is billed as output: kept low.
    assert first["reasoning"] == {"effort": "low"}


def test_a_dear_or_unpriced_batch_model_is_refused_before_submitting() -> None:
    called: list[int] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        called.append(1)
        return httpx.Response(202, json=batch("validating"))

    # The cap reads the batch tier's own listing (`<model>:batch`).
    with pytest.raises(ModelError, match="cap"):
        client(handler, {"x/y:batch": Decimal("1.5")}).submit("x/y", REQUESTS)
    with pytest.raises(ModelError, match="no output price"):
        client(handler, {}).submit("x/y", REQUESTS)
    assert called == []


def test_a_running_batch_has_no_items_yet() -> None:
    for status in ("validating", "in_progress", "finalizing", "cancelling"):
        got = client(lambda _r, s=status: httpx.Response(200, json=batch(s))).status(
            "batch_abc"
        )
        assert got.state == "running" and got.items == [] and got.cost_usd is None


def test_a_completed_batch_gives_each_item_its_text_or_error_and_the_cost() -> None:
    results = [
        {
            "custom_id": "draft-9",
            "id": "r2",
            "response": {"status_code": 200, "request_id": "q2", "body": None},
            "error": {
                "type": "error",
                "message": "provider overloaded",
                "param": None,
                "error_type": "provider_overloaded",
            },
        },
        {
            "custom_id": "draft-7",
            "id": "r1",
            "response": {
                "status_code": 200,
                "request_id": "q1",
                "body": completion('{"questions": []}', 1200, 300),
            },
            "error": None,
        },
    ]
    done = batch(
        "completed",
        results=results,
        usage={"cost": 0.000165, "cost_details": {}},
        request_counts={"total": 2, "completed": 1, "failed": 1},
    )
    got = client(lambda _r: httpx.Response(200, json=done)).status("batch_abc")
    assert got.state == "completed"
    assert got.cost_usd == Decimal("0.000165")
    by_id = {item.custom_id: item for item in got.items}
    assert by_id["draft-7"] == BatchItem(
        "draft-7", '{"questions": []}', None, 1200, 300
    )
    assert by_id["draft-9"].text is None
    assert by_id["draft-9"].error is not None and "overloaded" in by_id["draft-9"].error


@pytest.mark.parametrize("status", ["failed", "expired", "cancelled"])
def test_a_batch_that_ended_without_results_is_failed(status: str) -> None:
    ended = batch(status, error={"message": "provider rejected the batch"})
    got = client(lambda _r: httpx.Response(200, json=ended)).status("batch_abc")
    assert got.state == "failed" and got.items == []
    assert got.error is not None


@pytest.mark.parametrize(
    "response",
    [
        # Completed without a cost can't be budgeted (OPS-4): refused, retried later.
        httpx.Response(200, json=batch("completed", results=[], usage=None)),
        # Not enough balance to release the results: polled again later.
        httpx.Response(402, json={"error": {"code": 402, "message": "balance"}}),
        httpx.Response(200, text="not json"),
    ],
)
def test_failures_to_read_a_batch_are_model_errors(response: httpx.Response) -> None:
    with pytest.raises(ModelError, match="batch"):
        client(lambda _r: response).status("batch_abc")


def test_a_gone_batch_is_failed_so_its_requests_can_go_again() -> None:
    for code in (404, 410):
        got = client(lambda _r, c=code: httpx.Response(c, json={})).status("b")
        assert got.state == "failed" and got.items == []


def test_an_odd_result_body_fails_only_its_item() -> None:
    results = [
        {
            "custom_id": "a",
            "id": "1",
            "response": {"status_code": 500, "body": {"error": {"message": "x"}}},
            "error": None,
        },
        {
            "custom_id": "b",
            "id": "2",
            "response": {"status_code": 200, "body": {"unexpected": True}},
            "error": None,
        },
        {
            "custom_id": "c",
            "id": "3",
            "response": {"status_code": 200, "body": completion("ok", 10, 2)},
            "error": None,
        },
    ]
    done = batch("completed", results=results, usage={"cost": 0.0001})
    got = client(lambda _r: httpx.Response(200, json=done)).status("b")
    by_id = {item.custom_id: item for item in got.items}
    assert by_id["a"].text is None and by_id["b"].text is None
    assert by_id["c"].text == "ok"


def test_an_expired_batch_that_ran_part_way_keeps_its_results_and_cost() -> None:
    results = [
        {
            "custom_id": "a",
            "id": "1",
            "response": {"status_code": 200, "body": completion("ok", 10, 2)},
            "error": None,
        }
    ]
    ended = batch("expired", results=results, usage={"cost": 0.00005})
    got = client(lambda _r: httpx.Response(200, json=ended)).status("b")
    assert got.state == "completed" and got.cost_usd == Decimal("0.00005")
    assert [i.text for i in got.items] == ["ok"]
