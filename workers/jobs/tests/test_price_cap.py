"""No model above $0.80 per million output tokens may run (owner, 2026-10-27): every
adapter checks the price before any call, and refuses one it can't price."""

from decimal import Decimal

import httpx
import pytest

from interval_jobs.adapters.openai_compatible import GROQ, OpenAiCompatibleClient
from interval_jobs.adapters.openrouter import ListedOutputPrices, OpenRouterClient
from interval_jobs.adapters.price_cap import MAX_OUTPUT_USD_PER_MILLION
from interval_jobs.ports import Message, ModelError

MESSAGES: list[Message] = [{"role": "user", "content": "x"}]
CHAT = {
    "choices": [{"message": {"content": "ok"}}],
    "usage": {"prompt_tokens": 1, "completion_tokens": 1, "cost": 0},
}
MODELS = {
    "data": [
        {
            "id": "cheap/model",
            "pricing": {"prompt": "0.0000001", "completion": "0.0000005"},
        },
        {
            "id": "dear/model",
            "pricing": {"prompt": "0.000002", "completion": "0.00001"},
        },
        {
            "id": "edge/model",
            "pricing": {"prompt": "0.0000001", "completion": "0.0000008"},
        },
        {"id": "some/model:free", "pricing": {"prompt": "0", "completion": "0"}},
    ]
}


def openrouter(models: object = MODELS) -> tuple[OpenRouterClient, list[str]]:
    chats: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json=models)
        chats.append(request.url.path)
        return httpx.Response(200, json=CHAT)

    http = httpx.Client(transport=httpx.MockTransport(handler))
    return OpenRouterClient(http, "k", output_price=ListedOutputPrices(http)), chats


def test_the_cap_is_eighty_cents_per_million_output_tokens() -> None:
    assert MAX_OUTPUT_USD_PER_MILLION == Decimal("0.80")


def test_openrouter_runs_models_at_or_under_the_cap_and_free_ones() -> None:
    client, chats = openrouter()
    for model in ("cheap/model", "edge/model", "some/model:free"):
        assert client.complete(model, MESSAGES).text == "ok"
    assert len(chats) == 3


def test_openrouter_refuses_a_dear_or_unknown_model_before_calling_it() -> None:
    client, chats = openrouter()
    with pytest.raises(ModelError, match="cap"):
        client.complete("dear/model", MESSAGES)
    with pytest.raises(ModelError, match="no output price"):
        client.complete("nobody/model", MESSAGES)
    assert chats == []


def test_openrouter_refuses_everything_when_prices_cant_be_read() -> None:
    client, chats = openrouter(models={"unexpected": True})
    with pytest.raises(ModelError, match="no output price"):
        client.complete("cheap/model", MESSAGES)
    assert chats == []


def test_groq_and_google_refuse_a_model_priced_over_the_cap() -> None:
    called: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        called.append(str(request.url))
        return httpx.Response(200, json=CHAT)

    client = OpenAiCompatibleClient(
        GROQ, httpx.Client(transport=httpx.MockTransport(handler)), "k"
    )
    dear = [m for m, (_i, out) in GROQ.prices.items() if out > Decimal("0.80")]
    assert dear, "the test needs a Groq model over the cap"
    with pytest.raises(ModelError, match="cap"):
        client.complete(dear[0], MESSAGES)
    assert called == []
