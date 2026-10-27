"""LLM adapter (ADR-0007): OpenRouter's chat completions API. Only ai/gateway.py calls
it. The request asks OpenRouter to report the call's cost, which the gateway records
(OPS-4)."""

import time
from collections.abc import Callable
from decimal import Decimal

import httpx
from pydantic import BaseModel, ValidationError

from interval_db.generated import AiProvider
from interval_jobs.adapters.price_cap import refuse_over_cap
from interval_jobs.adapters.rate_limited import post_until_allowed
from interval_jobs.ports import Completion, Message, ModelError

URL = "https://openrouter.ai/api/v1/chat/completions"
MODELS_URL = "https://openrouter.ai/api/v1/models"
TIMEOUT_S = 120.0


class _Message(BaseModel):
    content: str


class _Choice(BaseModel):
    message: _Message


class _Usage(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    cost: Decimal


class _Response(BaseModel):
    choices: list[_Choice]
    usage: _Usage


class _Pricing(BaseModel):
    completion: Decimal  # USD per token


class _Listed(BaseModel):
    id: str
    pricing: _Pricing


class _Models(BaseModel):
    data: list[_Listed]


class _Endpoint(BaseModel):
    pricing: _Pricing


class _ModelEndpoints(BaseModel):
    endpoints: list[_Endpoint]


class _EndpointsResponse(BaseModel):
    data: _ModelEndpoints


class ListedOutputPrices:
    """Each model's listed output price per million tokens, read once from OpenRouter
    (for the price cap). A model left out of that list is priced from its own
    endpoints listing, at its dearest provider. Unreadable or unlisted means unknown,
    and so refused."""

    def __init__(self, http: httpx.Client) -> None:
        self._http = http
        self._prices: dict[str, Decimal] | None = None

    def __call__(self, model: str) -> Decimal | None:
        if self._prices is None:
            try:
                response = self._http.get(MODELS_URL, timeout=TIMEOUT_S)
                response.raise_for_status()
                listed = _Models.model_validate_json(response.content).data
                self._prices = {m.id: m.pricing.completion * 1_000_000 for m in listed}
            except (httpx.HTTPError, ValidationError):
                return None  # tried again on the next call
        if model not in self._prices:
            found = self._from_endpoints(model)
            if found is None:
                return None
            self._prices[model] = found
        return self._prices[model]

    def _from_endpoints(self, model: str) -> Decimal | None:
        try:
            response = self._http.get(
                f"https://openrouter.ai/api/v1/models/{model}/endpoints",
                timeout=TIMEOUT_S,
            )
            response.raise_for_status()
            endpoints = _EndpointsResponse.model_validate_json(
                response.content
            ).data.endpoints
        except (httpx.HTTPError, ValidationError):
            return None
        if not endpoints:
            return None
        return max(e.pricing.completion for e in endpoints) * 1_000_000


class OpenRouterClient:
    provider: AiProvider = "openrouter"

    def __init__(
        self,
        http: httpx.Client,
        api_key: str,
        sleep: Callable[[float], None] = time.sleep,
        output_price: Callable[[str], Decimal | None] | None = None,
    ) -> None:
        self._http = http
        self._api_key = api_key
        self._sleep = sleep
        self._output_price = output_price or ListedOutputPrices(http)

    def complete(self, model: str, messages: list[Message]) -> Completion:
        refuse_over_cap("openrouter", model, self._output_price(model))
        try:
            response = post_until_allowed(
                self._http,
                URL,
                json={"model": model, "messages": messages, "usage": {"include": True}},
                headers={"authorization": f"Bearer {self._api_key}"},
                timeout=TIMEOUT_S,
                sleep=self._sleep,
            )
            response.raise_for_status()
            body = _Response.model_validate_json(response.content)
        except (httpx.HTTPError, ValidationError) as error:
            raise ModelError(f"openrouter {model}: {error}") from error
        if not body.choices:
            raise ModelError(f"openrouter {model}: no choices in the response")
        return Completion(
            text=body.choices[0].message.content,
            input_tokens=body.usage.prompt_tokens,
            output_tokens=body.usage.completion_tokens,
            cost_usd=body.usage.cost,
        )
