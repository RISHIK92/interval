"""LLM adapter for providers with OpenAI-compatible chat completions: Groq (ADR-0020)
and Google's Gemini API (ADR-0021). Only ai/gateway.py calls it. They report tokens,
not cost, so the cost comes from each provider's price table (OPS-4)."""

import time
from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal

import httpx
from pydantic import BaseModel, ValidationError

from interval_db.generated import AiProvider
from interval_jobs.adapters.rate_limited import post_until_allowed
from interval_jobs.ports import Completion, Message, ModelError

TIMEOUT_S = 120.0


@dataclass(frozen=True)
class Provider:
    provider: AiProvider
    url: str
    key_name: str  # the environment variable holding its key
    # USD per million tokens (input, output); a model not listed is refused.
    prices: dict[str, tuple[Decimal, Decimal]]


GROQ = Provider(
    "groq",
    "https://api.groq.com/openai/v1/chat/completions",
    "GROQ_API_KEY",
    # shortcut: from memory on 2026-10-27, not checked against groq.com/pricing (its
    # page is script-rendered); the owner confirms before budgets rely on them.
    {
        "openai/gpt-oss-120b": (Decimal("0.15"), Decimal("0.75")),
        "openai/gpt-oss-20b": (Decimal("0.10"), Decimal("0.50")),
        "qwen/qwen3.8-27b": (Decimal("0.30"), Decimal("1.20")),
    },
)

GOOGLE = Provider(
    "google",
    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    "GOOGLE_API_KEY",
    # Gemma is free in the Gemini API (ADR-0021); tokens are still recorded.
    {
        "gemma-4-31b-it": (Decimal(0), Decimal(0)),
        "gemma-4-26b-a4b-it": (Decimal(0), Decimal(0)),
    },
)


class _Message(BaseModel):
    content: str | None


class _Choice(BaseModel):
    message: _Message


class _Usage(BaseModel):
    prompt_tokens: int
    completion_tokens: int


class _Response(BaseModel):
    choices: list[_Choice]
    usage: _Usage


class OpenAiCompatibleClient:
    def __init__(
        self,
        spec: Provider,
        http: httpx.Client,
        api_key: str | None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        # None when the provider isn't configured: only its models then fail.
        self._spec = spec
        self._http = http
        self._api_key = api_key
        self._sleep = sleep

    @property
    def provider(self) -> AiProvider:
        return self._spec.provider

    def complete(self, model: str, messages: list[Message]) -> Completion:
        name = self._spec.provider
        if not self._api_key:
            raise ModelError(f"{self._spec.key_name} is not set")
        price = self._spec.prices.get(model)
        if price is None:
            raise ModelError(f"{name} {model}: no price on record for this model")
        try:
            response = post_until_allowed(
                self._http,
                self._spec.url,
                json={"model": model, "messages": messages},
                headers={"authorization": f"Bearer {self._api_key}"},
                timeout=TIMEOUT_S,
                sleep=self._sleep,
            )
            response.raise_for_status()
            body = _Response.model_validate_json(response.content)
        except (httpx.HTTPError, ValidationError) as error:
            raise ModelError(f"{name} {model}: {error}") from error
        text = body.choices[0].message.content if body.choices else None
        # Gemma on the Gemini API writes its reasoning first, in <thought> tags
        # (2026-10-27); only what follows is the answer.
        if text is not None and text.lstrip().startswith("<thought>"):
            text = text.partition("</thought>")[2].strip()
        if not text:
            raise ModelError(f"{name} {model}: empty answer")
        price_in, price_out = price
        return Completion(
            text=text,
            input_tokens=body.usage.prompt_tokens,
            output_tokens=body.usage.completion_tokens,
            cost_usd=(
                price_in * body.usage.prompt_tokens
                + price_out * body.usage.completion_tokens
            )
            / 1_000_000,
        )
