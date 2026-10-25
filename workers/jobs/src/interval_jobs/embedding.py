"""Embeddings per moment (DB-3, AI-4, P1-W3-S04): each moment's text, cut from the
stored full text the way tagging cuts it, embedded through the gateway (ADR-0008) as a
document. Only full-text items have stored text, so only they get vectors (ING-2).
"""

from dataclasses import dataclass
from decimal import Decimal

from interval_jobs.ai.gateway import AiGateway, OverBudget
from interval_jobs.ports import TagInput
from interval_jobs.tagging import moment_texts

BATCH = 32  # texts per call, well inside Voyage's per-request limits
MOMENT_CHARS = 16000  # a moment far longer than 8 minutes is cut, not refused


@dataclass(frozen=True)
class ItemVectors:
    vectors: dict[int, list[float]]  # by moment id
    cost_usd: Decimal
    refused: OverBudget | None  # set when the budget stopped the pass part way


def embed_item(
    gateway: AiGateway, model: str, item: TagInput, skip: set[int]
) -> ItemVectors:
    """Vectors by moment id for moments with text, except those in `skip` (already
    embedded by this model). A budget refusal part way keeps what was paid for."""
    texts = moment_texts(item.full_text, item.moments) if item.full_text else {}
    ids = [
        m.id
        for m in sorted(item.moments, key=lambda m: m.ordinal)
        if texts.get(m.id) and m.id not in skip
    ]
    vectors: dict[int, list[float]] = {}
    cost = Decimal(0)
    for start in range(0, len(ids), BATCH):
        batch = ids[start : start + BATCH]
        result = gateway.embed(
            feature="embeddings",
            user_id=None,
            model=model,
            texts=[texts[i][:MOMENT_CHARS] for i in batch],
            purpose="document",
        )
        if isinstance(result, OverBudget):
            return ItemVectors(vectors, cost, result)
        vectors.update(zip(batch, result.vectors, strict=True))
        cost += result.usage.cost_usd
    return ItemVectors(vectors, cost, None)
