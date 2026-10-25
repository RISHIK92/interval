"""The model client adapters (ADR-0007): OpenRouter for completions, Voyage AI for
embeddings. httpx's mock transport plays the providers; no real calls."""

import json
from decimal import Decimal

import httpx
import pytest

from interval_jobs.adapters.openrouter import OpenRouterClient
from interval_jobs.adapters.voyage import VoyageClient
from interval_jobs.ports import Message, ModelError

MESSAGES: list[Message] = [{"role": "user", "content": "draft"}]


def client(handler: httpx.MockTransport) -> httpx.Client:
    return httpx.Client(transport=handler)


def test_openrouter_returns_text_tokens_and_the_reported_cost() -> None:
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"role": "assistant", "content": "hello"}}],
                "usage": {"prompt_tokens": 12, "completion_tokens": 3, "cost": 0.00042},
            },
        )

    llm = OpenRouterClient(client(httpx.MockTransport(handle)), api_key="k")
    got = llm.complete("vendor/model", MESSAGES)
    assert (got.text, got.input_tokens, got.output_tokens) == ("hello", 12, 3)
    assert got.cost_usd == Decimal("0.00042")
    body = json.loads(seen[0].content)
    assert body["model"] == "vendor/model"
    assert body["usage"] == {"include": True}  # so the cost is reported
    assert seen[0].headers["authorization"] == "Bearer k"


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(429, json={"error": {"message": "rate limited"}}),
        httpx.Response(200, json={"choices": []}),
        httpx.Response(200, text="not json"),
    ],
)
def test_openrouter_failures_are_model_errors(response: httpx.Response) -> None:
    llm = OpenRouterClient(
        client(httpx.MockTransport(lambda _r: response)), api_key="k"
    )
    with pytest.raises(ModelError):
        llm.complete("vendor/model", MESSAGES)


def test_voyage_returns_vectors_in_order_and_prices_the_tokens() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["input"] == ["a", "b"]
        assert (body["input_type"], body["output_dimension"]) == ("document", 1024)
        return httpx.Response(
            200,
            json={
                "data": [
                    {"index": 1, "embedding": [0.2] * 1024},
                    {"index": 0, "embedding": [0.1] * 1024},
                ],
                "usage": {"total_tokens": 1_000_000},
            },
        )

    voyage = VoyageClient(client(httpx.MockTransport(handle)), api_key="k")
    got = voyage.embed("voyage-3.5", ["a", "b"], "document")
    assert [v[0] for v in got.vectors] == [0.1, 0.2]
    assert (got.input_tokens, got.cost_usd) == (1_000_000, Decimal("0.06"))


def test_voyage_refuses_a_model_it_has_no_price_for() -> None:
    voyage = VoyageClient(
        client(httpx.MockTransport(lambda _r: httpx.Response(500))), api_key="k"
    )
    with pytest.raises(ModelError, match="price"):
        voyage.embed("voyage-unknown", ["a"], "document")


def test_voyage_without_a_key_refuses_to_embed() -> None:
    voyage = VoyageClient(
        client(httpx.MockTransport(lambda _r: httpx.Response(500))), api_key=None
    )
    with pytest.raises(ModelError, match="VOYAGE_API_KEY"):
        voyage.embed("voyage-3.5", ["a"], "query")


def test_voyage_refuses_vectors_of_the_wrong_dimension() -> None:
    short = httpx.Response(
        200,
        json={"data": [{"index": 0, "embedding": [0.1]}], "usage": {"total_tokens": 1}},
    )
    voyage = VoyageClient(client(httpx.MockTransport(lambda _r: short)), api_key="k")
    with pytest.raises(ModelError, match="1024"):
        voyage.embed("voyage-3.5", ["a"], "document")
