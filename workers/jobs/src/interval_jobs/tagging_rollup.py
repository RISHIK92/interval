"""A decision model's stored probabilities turned into tags (tagging v3, 2026-10-27).

Pure, and cheap to rerun: the cut-offs can be retuned on stored answers without asking
the model again (`eval-tagging` sweeps them). An article has only its own pass
(ADR-0058); a book chapter has its sessions' passes and its title pass.
- A session keeps every concept at or over `session`, most likely first, at most five;
  with nothing over it, none: much of what's read teaches no concept in the graph.
- The whole keeps concepts at or over `session` in at least two of its sessions, or at
  or over `strong` in one, or at or over `title` in its own pass (an article's only
  rule); possibly none.
- Difficulty is the session's score rounded (halves up); the whole's is the median of
  its sessions' scores, or its own pass's score when it has none."""

import math
from dataclasses import dataclass
from statistics import median
from typing import cast, get_args

from interval_db.generated import Difficulty
from interval_jobs.ports import ItemDecisions, TagResult, Tags
from interval_jobs.tagging import MAX_CONCEPTS

MIN_SESSIONS = 2
_LEVELS: tuple[str, ...] = get_args(Difficulty.__value__)


@dataclass(frozen=True)
class Cutoffs:
    session: float = 0.7
    strong: float = 0.85
    title: float = 0.5


DEFAULT_CUTOFFS = Cutoffs()


def level(score: float) -> Difficulty:
    return cast(Difficulty, _LEVELS[min(2, max(0, math.floor(score + 0.5)))])


def _ranked(probabilities: dict[str, float], known: set[str]) -> list[str]:
    return sorted(
        (s for s in probabilities if s in known),
        key=lambda s: (-probabilities[s], s),
    )


def _session(
    probabilities: dict[str, float], known: set[str], cut: float
) -> frozenset[str]:
    ranked = _ranked(probabilities, known)
    return frozenset([s for s in ranked if probabilities[s] >= cut][:MAX_CONCEPTS])


def rollup(
    decisions: ItemDecisions,
    known: set[str],
    cutoffs: Cutoffs = DEFAULT_CUTOFFS,
) -> TagResult:
    sessions = {
        session_id: Tags(level(score), _session(probs, known, cutoffs.session))
        for session_id, (score, probs) in decisions.sessions.items()
    }
    # An article's folded moments (ADR-0058) count as its sections for the rules and
    # its level, as they did when they were tagged; only a book's sessions get tags.
    parts = [*decisions.sessions.values(), *decisions.folded.values()]
    best: dict[str, float] = {}  # each concept's highest probability anywhere
    in_sessions: dict[str, float] = {}  # ... in a session (the "strong" rule)
    counted: dict[str, int] = {}
    for _, probs in parts:
        for slug, p in probs.items():
            if slug not in known:
                continue
            best[slug] = max(best.get(slug, 0.0), p)
            in_sessions[slug] = max(in_sessions.get(slug, 0.0), p)
            if p >= cutoffs.session:
                counted[slug] = counted.get(slug, 0) + 1
    for slug, p in decisions.item.items():
        if slug in known:
            best[slug] = max(best.get(slug, 0.0), p)
    chosen = {
        s
        for s in best
        if counted.get(s, 0) >= MIN_SESSIONS
        or in_sessions.get(s, 0.0) >= cutoffs.strong
        or decisions.item.get(s, 0.0) >= cutoffs.title
    }
    # Ties: the slug, so a rerun picks the same five.
    ranked = sorted(best, key=lambda s: (-best[s], s))
    concepts = [s for s in ranked if s in chosen][:MAX_CONCEPTS]
    scores = [score for score, _ in parts]
    if scores:
        difficulty = level(median(scores))
    else:
        difficulty = level(decisions.item_difficulty or 0.0)
    return TagResult(
        Tags(difficulty, frozenset(concepts)), sessions, decisions.from_full_text
    )
