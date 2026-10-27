"""The tagging shortlist (2026-10-27): a moment's 15-25 candidate concepts, chosen with
no model call, so the decision model is asked about those instead of all 250.

Candidates, in order: concepts whose name or an alias appears in the moment's text
(whole words, any case), nearest the moment first; then up to `prior_size` more from
the article's title-and-summary vector (the prior); then the concepts nearest the
moment's own vector. A concept left off can never be tagged, so the shortlist's recall
is measured first (`eval-shortlist`)."""

import math
import re
from collections.abc import Iterable, Mapping, Sequence
from functools import lru_cache

from interval_jobs.ports import ConceptGraph

SIZE = 25
PRIOR_SIZE = 5


def _cosine(a: Sequence[float], b: Sequence[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    norms = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return dot / norms if norms else 0.0


def _by_nearness(
    vector: Sequence[float],
    slugs: Iterable[str],
    vectors: Mapping[str, Sequence[float]],
) -> list[str]:
    scored = [(_cosine(vector, vectors[s]) if s in vectors else -1.0, s) for s in slugs]
    return [slug for _, slug in sorted(scored, key=lambda pair: pair[0], reverse=True)]


@lru_cache(maxsize=4)
def _patterns(
    phrases: tuple[tuple[str, tuple[str, ...]], ...],
) -> tuple[tuple[str, re.Pattern[str]], ...]:
    # One alternation per concept, compiled once per graph: a graph has ~1,300 names
    # and aliases, more than re's own cache holds. A word may sit next to a hyphen on
    # either side ("Raft-style", "multi-raft"), never inside another word.
    return tuple(
        (
            slug,
            re.compile(
                r"(?<!\w)(?:" + "|".join(re.escape(p) for p in names) + r")(?!\w)",
                re.IGNORECASE,
            ),
        )
        for slug, names in phrases
    )


def alias_hits(text: str, graph: ConceptGraph) -> list[str]:
    """Active concepts whose name or an alias appears as whole words, in graph order."""
    key = tuple((c.slug, (c.name, *c.aliases)) for c in graph.concepts if not c.retired)
    return [slug for slug, pattern in _patterns(key) if pattern.search(text)]


def shortlist(
    moment: Sequence[float],
    prior: Sequence[float] | None,
    text: str,
    vectors: Mapping[str, Sequence[float]],
    graph: ConceptGraph,
    *,
    size: int = SIZE,
    prior_size: int = PRIOR_SIZE,
) -> list[str]:
    if size < 1:
        raise ValueError("a shortlist holds at least one concept")
    active = [c.slug for c in graph.concepts if not c.retired]
    ordered = _by_nearness(moment, alias_hits(text, graph), vectors)[:size]
    if prior is not None:
        fresh = [s for s in _by_nearness(prior, active, vectors) if s not in ordered]
        ordered += fresh[:prior_size]
    ordered += [s for s in _by_nearness(moment, active, vectors) if s not in ordered]
    return ordered[:size]


def recall(cases: Iterable[tuple[set[str], Sequence[str]]]) -> float:
    """The share of labelled concepts that made their moment's shortlist."""
    wanted = kept = 0
    for labelled, offered in cases:
        wanted += len(labelled)
        kept += len(labelled & set(offered))
    return kept / wanted if wanted else 0.0
