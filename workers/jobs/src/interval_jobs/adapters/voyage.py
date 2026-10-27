"""Embedding adapter (ADR-0007): Voyage AI's embeddings API. Only ai/gateway.py calls
it. Voyage reports tokens, not cost, so the cost comes from its published per-token
prices (owner to confirm against voyageai.com/pricing, 2026-10-26)."""

from decimal import Decimal

import httpx
from pydantic import BaseModel, ValidationError

from interval_db.generated import AiProvider
from interval_jobs.ports import EmbeddingPurpose, Embeddings, ModelError

URL = "https://api.voyageai.com/v1/embeddings"
TIMEOUT_S = 60.0
# The moment_embedding column's dimension (P1-W3-S04).
DIMENSIONS = 1024
# USD per million tokens. A model missing here is refused: an unpriced call would
# slip past the cost budgets (OPS-4).
PRICE_PER_MILLION: dict[str, Decimal] = {
    "voyage-3.5": Decimal("0.06"),
    "voyage-3.5-lite": Decimal("0.02"),
    "voyage-3-large": Decimal("0.18"),
    "voyage-4-lite": Decimal("0.02"),
    "voyage-4": Decimal("0.06"),
    "voyage-4-large": Decimal("0.12"),
}


class _Item(BaseModel):
    index: int
    embedding: list[float]


class _Usage(BaseModel):
    total_tokens: int


class _Response(BaseModel):
    data: list[_Item]
    usage: _Usage


class VoyageClient:
    provider: AiProvider = "voyage"

    def __init__(self, http: httpx.Client, api_key: str | None) -> None:
        # None until embeddings are configured (W3-S04): commands that never embed
        # still build the gateway.
        self._http = http
        self._api_key = api_key

    def embed(
        self, model: str, texts: list[str], purpose: EmbeddingPurpose
    ) -> Embeddings:
        if not self._api_key:
            raise ModelError("VOYAGE_API_KEY is not set")
        price = PRICE_PER_MILLION.get(model)
        if price is None:
            raise ModelError(f"voyage {model}: no price on record for this model")
        try:
            response = self._http.post(
                URL,
                json={
                    "model": model,
                    "input": texts,
                    "input_type": purpose,
                    "output_dimension": DIMENSIONS,
                },
                headers={"authorization": f"Bearer {self._api_key}"},
                timeout=TIMEOUT_S,
            )
            response.raise_for_status()
            body = _Response.model_validate_json(response.content)
        except (httpx.HTTPError, ValidationError) as error:
            raise ModelError(f"voyage {model}: {error}") from error
        if len(body.data) != len(texts):
            raise ModelError(
                f"voyage {model}: {len(body.data)} vectors for {len(texts)}"
            )
        ordered = sorted(body.data, key=lambda item: item.index)
        if any(len(item.embedding) != DIMENSIONS for item in ordered):
            raise ModelError(
                f"voyage {model}: vectors are not {DIMENSIONS}-dimensional"
            )
        tokens = body.usage.total_tokens
        return Embeddings(
            vectors=[item.embedding for item in ordered],
            input_tokens=tokens,
            cost_usd=price * tokens / 1_000_000,
        )
