"""Candidate generation (REC-1, Q-P1-13, Q-P1-14, P1-W4-S02), in the worker
(ADR-0008). Every candidate is an article (ADR-0058).

Generators:
- topic match: articles on the user's chosen topics (cold start, Q-P1-14);
- projects: articles on the concepts the user's connected repositories map to
  (P2-W12-S04);
- embedding similarity: articles near those the user marked More like this or saved
  (Q-P1-13), by their article vectors.
Hidden sources, Not interested items and finished articles are never candidates
(Q-P1-15, P1-W5-S03); scoring is W4-S03.
"""

from dataclasses import dataclass, field
from typing import Literal

from interval_jobs.ports import CandidateArticle, Store, UserPreferences

type Generator = Literal["topic", "similar", "project"]

# shortcut: newest first, so older on-topic articles never get in past the limit;
# raise it or page if W4-S03 needs more.
TOPIC_LIMIT = 300
MAX_ANCHORS = 10  # liked items that seed the similarity search
PROJECT_LIMIT = 200  # P2-W12-S04: articles on the user's projects' concepts
PER_ANCHOR = 20


@dataclass
class Candidate:
    item_id: int
    source_id: int
    generators: set[Generator] = field(default_factory=set[Generator])
    similarity: float | None = None  # best cosine to an anchor, when similar


def candidates(store: Store, user_id: str, model: str | None) -> list[Candidate]:
    """`model` is the embedding model in use; None while embeddings are off."""
    preferences = store.ranking.preferences(user_id)
    if preferences is None:
        return []
    return candidates_for(store, preferences, user_id, model)


def candidates_for(
    store: Store, preferences: UserPreferences, user_id: str | None, model: str | None
) -> list[Candidate]:
    """With no user (a starter feed, ADR-0008) there is no feedback to honour and no
    liked item to find similar articles from: topic matches only."""
    inputs = store.ranking
    hidden = inputs.hidden_sources(user_id) if user_id else set[int]()
    # Not interested and finished articles alike are never offered again (P1-W5-S03).
    gone = (
        inputs.not_interested(user_id) | inputs.finished(user_id)
        if user_id
        else set[int]()
    )
    found: dict[int, Candidate] = {}

    def add(
        row: CandidateArticle, generator: Generator, score: float | None = None
    ) -> None:
        candidate = found.setdefault(row.item_id, Candidate(row.item_id, row.source_id))
        candidate.generators.add(generator)
        if score is not None and (
            candidate.similarity is None or score > candidate.similarity
        ):
            candidate.similarity = score

    for row in inputs.topic_articles(
        preferences.topics, TOPIC_LIMIT, exclude_sources=hidden, exclude_items=gone
    ):
        add(row, "topic")
    # P2-W12-S04 (REC-1 "projects", §5H): the same exclusions as topic matches (PER-1).
    projects = inputs.project_concepts(user_id) if user_id else {}
    for row in inputs.concept_articles(
        frozenset(projects), PROJECT_LIMIT, exclude_sources=hidden, exclude_items=gone
    ):
        add(row, "project")
    if model is not None and user_id is not None:
        anchors = inputs.anchor_items(user_id, MAX_ANCHORS)
        # Excluded in the query, before its limit: the anchors themselves would
        # otherwise fill the slots.
        skip_items = gone | set(anchors)
        for anchor in anchors:
            vector = store.embeddings.vector(anchor, model)
            if vector is None:
                continue
            for hit in store.embeddings.similar(
                vector,
                PER_ANCHOR,
                model=model,
                exclude_sources=hidden,
                exclude_items=skip_items,
            ):
                add(CandidateArticle(hit.item_id, hit.source_id), "similar", hit.score)
    return list(found.values())
