"""Decision-model adapter: OpenRouter's Decisions API (e.g. TypeSafe's Jev). Only
ai/gateway.py calls it. A decision model answers typed questions (choice, score,
yes/no) about a state with probabilities, not text; OpenRouter reports each call's
cost (OPS-4). The price cap applies as to any model."""

import time
from collections.abc import Callable
from decimal import Decimal
from typing import Annotated, Literal

import httpx
from pydantic import BaseModel, Field, ValidationError

from interval_db.generated import AiProvider
from interval_jobs.adapters.openrouter import ListedOutputPrices
from interval_jobs.adapters.price_cap import refuse_over_cap
from interval_jobs.adapters.rate_limited import post_until_allowed
from interval_jobs.ports import (
    ChoiceAnswer,
    Decision,
    DecisionAnswer,
    DecisionState,
    ModelError,
    ScoreAnswer,
)

URL = "https://openrouter.ai/api/alpha/decisions"
TIMEOUT_S = 120.0


class _Choice(BaseModel):
    type: Literal["choice"]
    choice: str
    probabilities: dict[str, float] = {}


class _Score(BaseModel):
    type: Literal["score"]
    score: float


class _Usage(BaseModel):
    input_tokens: int
    output_tokens: int
    cost: Decimal  # required: a call without one can't be budgeted (OPS-4)


class _Response(BaseModel):
    answers: dict[str, Annotated[_Choice | _Score, Field(discriminator="type")]]
    usage: _Usage


def _answer(raw: _Choice | _Score) -> DecisionAnswer:
    if isinstance(raw, _Choice):
        return ChoiceAnswer(raw.choice, raw.probabilities)
    return ScoreAnswer(raw.score)


class OpenRouterDecisions:
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

    def decide(
        self, model: str, state: DecisionState, questions: dict[str, object]
    ) -> Decision:
        refuse_over_cap("openrouter", model, self._output_price(model))
        try:
            response = post_until_allowed(
                self._http,
                URL,
                json={"model": model, "state": state, "questions": questions},
                headers={"authorization": f"Bearer {self._api_key}"},
                timeout=TIMEOUT_S,
                sleep=self._sleep,
            )
            response.raise_for_status()
            body = _Response.model_validate_json(response.content)
        except (httpx.HTTPError, ValidationError) as error:
            raise ModelError(f"openrouter decisions {model}: {error}") from error
        return Decision(
            answers={name: _answer(raw) for name, raw in body.answers.items()},
            input_tokens=body.usage.input_tokens,
            output_tokens=body.usage.output_tokens,
            cost_usd=body.usage.cost,
        )
