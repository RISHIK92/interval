"""Batch adapter: OpenRouter's Batch API (Q-P2-13, P2-W8-S05). Only ai/gateway.py
calls it. Many chat requests go in one submission at the batch tier's price (half the
synchronous one) and come back later, minutes to 24 hours on; the cost is reported
for the whole batch once it completes (OPS-4). The price cap reads the batch tier's
own listing, `<model>:batch`."""

import time
from collections.abc import Callable, Sequence
from decimal import Decimal

import httpx
from pydantic import BaseModel, ValidationError

from interval_db.generated import AiProvider
from interval_jobs.adapters.openrouter import ListedOutputPrices
from interval_jobs.adapters.price_cap import refuse_over_cap
from interval_jobs.adapters.rate_limited import post_until_allowed
from interval_jobs.ports import (
    BatchItem,
    BatchNotFound,
    BatchRequest,
    BatchStatus,
    ModelError,
)

URL = "https://openrouter.ai/api/v1/batches"
TIMEOUT_S = 120.0
RUNNING = {"validating", "in_progress", "finalizing", "cancelling"}
ENDED = {"failed", "expired", "cancelled"}


class _Message(BaseModel):
    content: str | None = None


class _Choice(BaseModel):
    message: _Message


class _Usage(BaseModel):
    prompt_tokens: int
    completion_tokens: int


class _Completion(BaseModel):
    choices: list[_Choice]
    usage: _Usage | None = None


class _Response(BaseModel):
    status_code: int | None = None
    # Parsed per item (_item): one odd body mustn't fail the whole batch.
    body: dict[str, object] | None = None


class _ItemError(BaseModel):
    message: str
    error_type: str | None = None


class _Result(BaseModel):
    custom_id: str
    response: _Response | None = None
    error: _ItemError | None = None


class _BatchUsage(BaseModel):
    cost: Decimal | None = None


class _BatchError(BaseModel):
    message: str


class _Batch(BaseModel):
    id: str
    status: str
    results: list[_Result] | None = None
    usage: _BatchUsage | None = None
    error: _BatchError | None = None


def _item(result: _Result) -> BatchItem:
    def failed(reason: str) -> BatchItem:
        return BatchItem(result.custom_id, None, reason, 0, 0)

    if result.error is not None:
        kind = result.error.error_type
        return failed(
            f"{kind}: {result.error.message}" if kind else result.error.message
        )
    response = result.response
    if response is None or response.body is None:
        return failed("no response")
    if response.status_code is not None and response.status_code != 200:
        return failed(f"status {response.status_code}")
    try:
        body = _Completion.model_validate(response.body)
    except ValidationError:
        return failed("not a chat completion")
    text = body.choices[0].message.content if body.choices else None
    if text is None:
        return failed("no reply text")
    usage = body.usage
    return BatchItem(
        result.custom_id,
        text,
        None,
        usage.prompt_tokens if usage else 0,
        usage.completion_tokens if usage else 0,
    )


class OpenRouterBatches:
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

    def submit(self, model: str, requests: Sequence[BatchRequest]) -> str:
        tier = f"{model}:batch"
        refuse_over_cap("openrouter", tier, self._output_price(tier))
        body = {
            "endpoint": "/v1/chat/completions",
            "model": model,
            # The API refuses a body whose `requests` isn't its last key.
            "requests": [
                {
                    "custom_id": request.custom_id,
                    "body": {
                        "model": model,
                        "messages": request.messages,
                        # Haiku's thinking is billed as output; these tasks need
                        # little of it.
                        "reasoning": {"effort": "low"},
                    },
                }
                for request in requests
            ],
        }
        try:
            response = post_until_allowed(
                self._http,
                URL,
                json=body,
                headers={"authorization": f"Bearer {self._api_key}"},
                timeout=TIMEOUT_S,
                sleep=self._sleep,
            )
            response.raise_for_status()
            return _Batch.model_validate_json(response.content).id
        except (httpx.HTTPError, ValidationError) as error:
            raise ModelError(f"openrouter batch submit {model}: {error}") from error

    def status(self, batch_id: str) -> BatchStatus:
        try:
            response = self._http.get(
                f"{URL}/{batch_id}",
                headers={"authorization": f"Bearer {self._api_key}"},
                timeout=TIMEOUT_S,
            )
            if response.status_code == 404:
                # Seen live: a batch reads as 404 for a moment after it's accepted.
                # Failing it would free its requests and pay for them twice; it's read
                # again on the next run.
                raise BatchNotFound(f"openrouter batch {batch_id}: not found (yet)")
            if response.status_code == 410:
                # Its results were deleted (30 days on): nothing more will come; its
                # requests can go again.
                return BatchStatus("failed", [], None, "gone (410)")
            response.raise_for_status()
            batch = _Batch.model_validate_json(response.content)
        except (httpx.HTTPError, ValidationError) as error:
            raise ModelError(f"openrouter batch {batch_id}: {error}") from error
        if batch.status in RUNNING:
            return BatchStatus("running", [], None, None)
        cost = batch.usage.cost if batch.usage else None
        items = [_item(r) for r in batch.results or []]
        if batch.status in ENDED:
            # An expired or cancelled batch may have run (and billed) part of its
            # requests: keep what came back, and its cost.
            reason = batch.error.message if batch.error else batch.status
            if cost is None:
                return BatchStatus("failed", [], None, reason)
            return BatchStatus("completed", items, cost, reason)
        if batch.status != "completed":
            raise ModelError(f"openrouter batch {batch_id}: status {batch.status}")
        if cost is None:
            # Without the cost a batch can't be budgeted (OPS-4): read it again later.
            raise ModelError(f"openrouter batch {batch_id}: completed without a cost")
        return BatchStatus("completed", items, cost, None)
