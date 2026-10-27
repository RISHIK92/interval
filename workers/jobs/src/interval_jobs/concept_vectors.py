"""Concept vectors for the tagging shortlist (2026-10-27): each active concept's
"name: description" embedded through the gateway (ADR-0008), once per model, and
again only when that text changes."""

import hashlib
from dataclasses import dataclass
from decimal import Decimal

from interval_jobs.ai.gateway import AiGateway, OverBudget
from interval_jobs.ports import ModelError, Store

BATCH = 64


def concept_text(name: str, description: str | None) -> str:
    return f"{name}: {description}" if description else name


def text_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


@dataclass(frozen=True)
class ConceptVectors:
    embedded: int
    cost_usd: Decimal
    refused: OverBudget | None
    failed: str | None = None  # a model error part way; batches before it are kept


def embed_concepts(gateway: AiGateway, store: Store, model: str) -> ConceptVectors:
    graph = store.concepts.state()
    if graph is None:
        return ConceptVectors(0, Decimal(0), None)
    have = store.concepts.vectors(model)
    todo: list[tuple[str, str, str]] = []  # slug, text, hash
    for concept in graph.concepts:
        if concept.retired:
            continue
        text = concept_text(concept.name, concept.description)
        digest = text_hash(text)
        if have.get(concept.slug, ("",))[0] != digest:
            todo.append((concept.slug, text, digest))
    cost, done = Decimal(0), 0
    for start in range(0, len(todo), BATCH):
        batch = todo[start : start + BATCH]
        try:
            result = gateway.embed(
                feature="embeddings",
                user_id=None,
                model=model,
                texts=[text for _, text, _ in batch],
                purpose="document",
            )
        except ModelError as error:
            return ConceptVectors(done, cost, None, str(error))
        if isinstance(result, OverBudget):
            return ConceptVectors(done, cost, result)
        for (slug, _, digest), vector in zip(batch, result.vectors, strict=True):
            store.concepts.save_vector(slug, model, digest, vector)
        cost += result.usage.cost_usd
        done += len(batch)
    return ConceptVectors(done, cost, None)
