"""Groq and Google as LLM providers (ADR-0020, ADR-0021): OpenAI-compatible chat
completions, costed from a price table because the response reports tokens only
(OPS-4)."""

import json
from collections.abc import Mapping
from decimal import Decimal

import httpx
import pytest

from interval_jobs.adapters.openai_compatible import (
    GOOGLE,
    GROQ,
    OpenAiCompatibleClient,
)
from interval_jobs.ports import ModelError

MODEL = "openai/gpt-oss-120b"


def answer(body: Mapping[str, object], status: int = 200) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        sent = json.loads(request.content)
        assert sent["model"] == MODEL
        assert request.headers["authorization"] == "Bearer k"
        return httpx.Response(status, json=dict(body))

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_a_completion_is_costed_from_the_price_table() -> None:
    body = {
        "choices": [{"message": {"content": "{}"}}],
        "usage": {"prompt_tokens": 1_000_000, "completion_tokens": 500_000},
    }
    got = OpenAiCompatibleClient(GROQ, answer(body), "k").complete(
        MODEL, [{"role": "user", "content": "x"}]
    )
    price_in, price_out = GROQ.prices[MODEL]
    assert got.text == "{}"
    assert (got.input_tokens, got.output_tokens) == (1_000_000, 500_000)
    assert got.cost_usd == price_in + price_out / 2


def test_a_model_without_a_price_is_refused_before_any_call() -> None:
    with pytest.raises(ModelError, match="no price"):
        OpenAiCompatibleClient(GROQ, answer({}), "k").complete("unknown/model", [])


def test_no_key_or_a_failed_call_is_a_model_error() -> None:
    with pytest.raises(ModelError, match="GROQ_API_KEY"):
        OpenAiCompatibleClient(GROQ, answer({}), None).complete(MODEL, [])
    with pytest.raises(ModelError, match="groq"):
        OpenAiCompatibleClient(
            GROQ, answer({"error": "busy"}, 429), "k", sleep=lambda _s: None
        ).complete(MODEL, [])


def test_an_empty_answer_is_a_model_error() -> None:
    body = {
        "choices": [{"message": {"content": None}}],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1},
    }
    with pytest.raises(ModelError, match="empty"):
        OpenAiCompatibleClient(GROQ, answer(body), "k").complete(MODEL, [])


def test_each_provider_names_its_url_key_and_prices() -> None:
    assert (GROQ.provider, GOOGLE.provider) == ("groq", "google")
    assert GROQ.url.startswith("https://api.groq.com/")
    assert GOOGLE.url.startswith("https://generativelanguage.googleapis.com/")
    assert (GROQ.key_name, GOOGLE.key_name) == ("GROQ_API_KEY", "GOOGLE_API_KEY")
    # ADR-0021: Gemma is free in the Gemini API; its tokens are still recorded.
    assert GOOGLE.prices["gemma-4-31b-it"] == (Decimal(0), Decimal(0))
    assert all(p >= 0 for pair in GROQ.prices.values() for p in pair)


def test_a_google_call_is_free_but_counted() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "generativelanguage.googleapis.com"
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "{}"}}],
                "usage": {"prompt_tokens": 900, "completion_tokens": 100},
            },
        )

    client = OpenAiCompatibleClient(
        GOOGLE, httpx.Client(transport=httpx.MockTransport(handler)), "k"
    )
    got = client.complete("gemma-4-31b-it", [{"role": "user", "content": "x"}])
    assert (got.input_tokens, got.output_tokens, got.cost_usd) == (900, 100, 0)


def test_gemmas_inline_thinking_is_left_out_of_the_answer() -> None:
    # Gemma on the Gemini API puts its reasoning before the answer (2026-10-27); only
    # the answer is the model's output.
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"content": '<thought>plan…</thought>\n{"a": 1}'}}
                ],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1},
            },
        )

    client = OpenAiCompatibleClient(
        GOOGLE, httpx.Client(transport=httpx.MockTransport(handler)), "k"
    )
    assert client.complete("gemma-4-26b-a4b-it", []).text == '{"a": 1}'
