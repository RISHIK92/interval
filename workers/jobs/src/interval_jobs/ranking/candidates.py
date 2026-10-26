"""Candidate generation (REC-1, Q-P1-13, Q-P1-14, P1-W4-S02), in the worker
(ADR-0008).

Generators with data in Phase 1:
- topic match: moments of items on the user's chosen topics (cold start, Q-P1-14);
- embedding similarity: moments near those of items the user marked More like this.
  Q-P1-13 names saved and finished items as the anchors; neither exists until W4-S07
  and W5, so More like this stands in, and those join when they do (overnight pick,
  2026-10-26, in docs/progress.md for the owner).
Continue items need reading progress, so that generator comes with W5-S03 (deferred,
also flagged). Hidden sources and Not interested items are never candidates
(Q-P1-15); scoring is W4-S03.
"""

from dataclasses import dataclass, field
from typing import Literal

from interval_jobs.ports import CandidateMoment, Store

type Generator = Literal["topic", "similar"]

# shortcut: counted in moments, newest first, so a few long articles can fill it and
# older on-topic items never get in; raise it or page by item if W4-S03 needs more.
TOPIC_LIMIT = 300
MAX_ANCHORS = 10  # liked items whose moments seed the similarity search
PER_ANCHOR = 20


@dataclass
class Candidate:
    moment_id: int
    item_id: int
    source_id: int
    generators: set[Generator] = field(default_factory=set[Generator])
    similarity: float | None = None  # best cosine to an anchor, when similar


def candidates(store: Store, user_id: str, model: str | None) -> list[Candidate]:
    """`model` is the embedding model in use; None while embeddings are off."""
    inputs = store.ranking
    preferences = inputs.preferences(user_id)
    if preferences is None:
        return []
    hidden = inputs.hidden_sources(user_id)
    gone = inputs.not_interested(user_id)
    found: dict[int, Candidate] = {}

    def add(
        row: CandidateMoment, generator: Generator, score: float | None = None
    ) -> None:
        candidate = found.setdefault(
            row.moment_id, Candidate(row.moment_id, row.item_id, row.source_id)
        )
        candidate.generators.add(generator)
        if score is not None and (
            candidate.similarity is None or score > candidate.similarity
        ):
            candidate.similarity = score

    for row in inputs.topic_moments(
        preferences.topics, TOPIC_LIMIT, exclude_sources=hidden, exclude_items=gone
    ):
        add(row, "topic")
    if model is not None:
        anchors = inputs.liked_items(user_id, MAX_ANCHORS)
        # Excluded in the query, before its limit: an anchor's own moments would
        # otherwise fill every slot.
        skip_items = gone | set(anchors)
        for anchor in anchors:
            for vector in store.embeddings.vectors_of_item(anchor, model):
                for hit in store.embeddings.similar(
                    vector,
                    PER_ANCHOR,
                    model=model,
                    exclude_sources=hidden,
                    exclude_items=skip_items,
                ):
                    row = CandidateMoment(hit.moment_id, hit.item_id, hit.source_id)
                    add(row, "similar", hit.score)
    return list(found.values())
