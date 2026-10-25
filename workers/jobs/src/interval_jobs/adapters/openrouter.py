"""LLM adapter (ADR-0007): OpenRouter's chat completions API. Only ai/gateway.py calls
it. The request asks OpenRouter to report the call's cost, which the gateway records
(OPS-4)."""

from decimal import Decimal

import httpx
from pydantic import BaseModel, ValidationError

from interval_db.generated import AiProvider
from interval_jobs.ports import Completion, Message, ModelError

URL = "https://openrouter.ai/api/v1/chat/completions"
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


class OpenRouterClient:
    provider: AiProvider = "openrouter"

    def __init__(self, http: httpx.Client, api_key: str) -> None:
        self._http = http
        self._api_key = api_key

    def complete(self, model: str, messages: list[Message]) -> Completion:
        try:
            response = self._http.post(
                URL,
                json={"model": model, "messages": messages, "usage": {"include": True}},
                headers={"authorization": f"Bearer {self._api_key}"},
                timeout=TIMEOUT_S,
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
