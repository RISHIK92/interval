"""One embedding per article (DB-3, AI-4, P1-W3-S04, ADR-0058): its stored full text,
cut to TEXT_CHARS, embedded through the gateway (ADR-0008) as a document. Only
full-text items have stored text, so only they get vectors (ING-2).
"""

from dataclasses import dataclass
from decimal import Decimal

from interval_jobs.ai.gateway import AiGateway, OverBudget
from interval_jobs.ports import TagInput

# The per-moment limit this replaces: a long article is cut, not refused.
TEXT_CHARS = 16000


@dataclass(frozen=True)
class ItemVector:
    vector: list[float] | None  # None: no text to embed, or refused
    cost_usd: Decimal
    refused: OverBudget | None  # set when the budget refused the call


def embed_item(gateway: AiGateway, model: str, item: TagInput) -> ItemVector:
    text = (item.full_text or "").strip()
    if not text:
        return ItemVector(None, Decimal(0), None)
    result = gateway.embed(
        feature="embeddings",
        user_id=None,
        model=model,
        texts=[text[:TEXT_CHARS]],
        purpose="document",
    )
    if isinstance(result, OverBudget):
        return ItemVector(None, Decimal(0), result)
    return ItemVector(result.vectors[0], result.usage.cost_usd, None)
