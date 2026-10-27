"""A decision model's stored probabilities turned into tags (tagging v3, 2026-10-27).

Pure, and cheap to rerun: the cut-offs can be retuned on stored answers without asking
the model again (`eval-tagging` sweeps them).
- A moment keeps every concept at or over `moment`, most likely first, at most five;
  with nothing over it, none: much of the feed teaches no concept in the graph.
- The article keeps concepts at or over `moment` in at least two of its moments, or at
  or over `strong` in one, or at or over `title` in its title/summary pass; possibly
  none.
- Difficulty is the moment's score rounded (halves up); the article's is the median of
  its moments' scores, or its title pass's score when it has no moments."""

import math
from dataclasses import dataclass
from statistics import median
from typing import cast, get_args

from interval_db.generated import Difficulty
from interval_jobs.ports import ItemDecisions, TagResult, Tags
from interval_jobs.tagging import MAX_CONCEPTS

MIN_MOMENTS = 2
_LEVELS: tuple[str, ...] = get_args(Difficulty.__value__)


@dataclass(frozen=True)
class Cutoffs:
    moment: float = 0.7
    strong: float = 0.85
    title: float = 0.5


DEFAULT_CUTOFFS = Cutoffs()


def level(score: float) -> Difficulty:
    return cast(Difficulty, _LEVELS[min(2, max(0, math.floor(score + 0.5)))])


def _ranked(probabilities: dict[str, float], known: set[str]) -> list[str]:
    return sorted(
        (s for s in probabilities if s in known),
        key=lambda s: probabilities[s],
        reverse=True,
    )


def _moment(
    probabilities: dict[str, float], known: set[str], cut: float
) -> frozenset[str]:
    ranked = _ranked(probabilities, known)
    return frozenset([s for s in ranked if probabilities[s] >= cut][:MAX_CONCEPTS])


def rollup(
    decisions: ItemDecisions,
    known: set[str],
    cutoffs: Cutoffs = DEFAULT_CUTOFFS,
    current: frozenset[int] | None = None,
) -> TagResult:
    """`current`: the item's moments with text now; answers for others are stale."""
    if current is not None:
        decisions = ItemDecisions(
            {m: a for m, a in decisions.moments.items() if m in current},
            decisions.item,
            decisions.item_difficulty,
        )
    moments = {
        moment_id: Tags(level(score), _moment(probs, known, cutoffs.moment))
        for moment_id, (score, probs) in decisions.moments.items()
    }
    best: dict[str, float] = {}  # each concept's highest probability anywhere
    in_moments: dict[str, float] = {}  # ... in a moment (the "strong" rule)
    counted: dict[str, int] = {}
    for _, probs in decisions.moments.values():
        for slug, p in probs.items():
            if slug not in known:
                continue
            best[slug] = max(best.get(slug, 0.0), p)
            in_moments[slug] = max(in_moments.get(slug, 0.0), p)
            if p >= cutoffs.moment:
                counted[slug] = counted.get(slug, 0) + 1
    for slug, p in decisions.item.items():
        if slug in known:
            best[slug] = max(best.get(slug, 0.0), p)
    chosen = {
        s
        for s in best
        if counted.get(s, 0) >= MIN_MOMENTS
        or in_moments.get(s, 0.0) >= cutoffs.strong
        or decisions.item.get(s, 0.0) >= cutoffs.title
    }
    ranked = sorted(best, key=lambda s: best[s], reverse=True)
    concepts = [s for s in ranked if s in chosen][:MAX_CONCEPTS]
    scores = [score for score, _ in decisions.moments.values()]
    if scores:
        difficulty = level(median(scores))
    else:
        difficulty = level(decisions.item_difficulty or 0.0)
    return TagResult(Tags(difficulty, frozenset(concepts)), moments)
