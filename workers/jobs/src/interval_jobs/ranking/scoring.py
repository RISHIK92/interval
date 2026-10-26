"""Rule-based scoring and re-ranking (REC-2, REC-3, Q-P1-13, P1-W4-S03).

Score = weighted sum of topic match, level fit (Q-P1-10), source quality (ING-6),
freshness and time fit to the user's break, minus penalties for Less like this and for
concepts of items the user said Not interested to (Q-P1-15). Hidden sources and Not
interested items never get here (W4-S02). Every weight is a row of `ranking_config`,
which the owner tunes in Week 6.

Re-ranking (REC-3) takes the best by MMR, `lambda * score - (1 - lambda) * max
similarity` to what is already picked, with scores scaled to 0-1 first so lambda means
the same whatever the weights; it skips a moment once its source has reached the cap.
Two moments are as similar as their items' concepts overlap (Jaccard), and moments of
one item or one source are at least 1.0 and 0.5 alike. Novelty slots come
with Thompson sampling (W4-S09).
"""

import math
from dataclasses import dataclass
from datetime import datetime

from interval_db.generated import BreakLength, Difficulty
from interval_jobs import log
from interval_jobs.ports import MomentFacts
from interval_jobs.ranking.candidates import Candidate

SIGNALS = ("topic_match", "level_fit", "quality", "freshness", "time_fit")
PENALTIES = ("less_like_this", "not_interested_concepts")
_LEVELS: dict[Difficulty, int] = {"beginner": 0, "intermediate": 1, "advanced": 2}
BREAK_MINUTES: dict[BreakLength, tuple[int, int]] = {
    "1-3": (1, 3),
    "3-8": (3, 8),
    "8-15": (8, 15),
}
# Only the long break wants long reads (owner, 2026-10-26): there, a 1-minute moment
# fits this much, rising to full fit at the break's lower bound.
_SHORT_IN_LONG_BREAK = 0.3


class RankingConfigError(ValueError):
    pass


@dataclass(frozen=True)
class RankingConfig:
    weights: dict[str, float]  # by signal
    penalties: dict[str, float]  # by penalty
    half_life_days: float
    mmr_lambda: float
    per_source_cap: int

    @staticmethod
    def from_rows(rows: dict[str, float]) -> "RankingConfig":
        needed = [
            *(f"weight.{s}" for s in SIGNALS),
            *(f"penalty.{p}" for p in PENALTIES),
            "freshness.half_life_days",
            "mmr.lambda",
            "cap.per_source",
        ]
        missing = [key for key in needed if key not in rows]
        if missing:
            raise RankingConfigError(f"ranking_config lacks {', '.join(missing)}")
        # A boundary (the owner edits the table): values that would break ranking.
        # Postgres numeric holds NaN and Infinity, which would scramble every score.
        for key in needed:
            if not math.isfinite(rows[key]):
                raise RankingConfigError(f"{key} must be finite")
            # A negative weight or penalty would reverse what its rule means.
            if rows[key] < 0:
                raise RankingConfigError(f"{key} must be 0 or more")
        if rows["freshness.half_life_days"] <= 0:
            raise RankingConfigError("freshness.half_life_days must be above 0")
        if not 0 <= rows["mmr.lambda"] <= 1:
            raise RankingConfigError("mmr.lambda must be between 0 and 1")
        cap = rows["cap.per_source"]
        if cap < 1 or cap != int(cap):
            raise RankingConfigError("cap.per_source must be a whole number above 0")
        return RankingConfig(
            weights={s: float(rows[f"weight.{s}"]) for s in SIGNALS},
            penalties={p: float(rows[f"penalty.{p}"]) for p in PENALTIES},
            half_life_days=float(rows["freshness.half_life_days"]),
            mmr_lambda=float(rows["mmr.lambda"]),
            per_source_cap=int(rows["cap.per_source"]),
        )


@dataclass(frozen=True)
class UserSignals:
    topics: frozenset[str]  # the user's chosen topics (explicit, PER-1)
    level: Difficulty
    break_length: BreakLength
    less_liked: frozenset[int]  # item ids
    avoided_concepts: frozenset[str]  # concepts of Not interested items


@dataclass(frozen=True)
class Scored:
    moment_id: int
    item_id: int
    source_id: int
    score: float
    # The largest weighted part: W4-S06's why-this-matters note says why (REC-5).
    top_signal: str


def _level_fit(difficulty: Difficulty | None, level: Difficulty) -> float:
    if difficulty is None:
        return 0.5  # untagged: neither a fit nor a miss
    return (1.0, 0.5, 0.0)[abs(_LEVELS[difficulty] - _LEVELS[level])]


def _freshness(published: datetime | None, now: datetime, half_life: float) -> float:
    if published is None:
        return 0.0
    age_days = max(0.0, (now - published).total_seconds() / 86400)
    return math.exp(-math.log(2) * age_days / half_life)


def _time_fit(minutes: int, break_length: BreakLength) -> float:
    low, limit = BREAK_MINUTES[break_length]
    if minutes > limit:
        # Past the break's length, fit falls off over the same length again.
        return max(0.0, 1.0 - (minutes - limit) / limit)
    if break_length == "8-15" and minutes < low:
        rise = (1.0 - _SHORT_IN_LONG_BREAK) * (minutes - 1) / (low - 1)
        return _SHORT_IN_LONG_BREAK + max(0.0, rise)
    return 1.0


def score(
    candidates: list[Candidate],
    facts: dict[int, MomentFacts],
    user: UserSignals,
    config: RankingConfig,
    now: datetime,
) -> list[Scored]:
    scored: list[Scored] = []
    for candidate in candidates:
        fact = facts.get(candidate.moment_id)
        if fact is None:
            # Re-segmented between the candidate and facts reads: it is gone.
            log.info("ranking: candidate moment gone", moment_id=candidate.moment_id)
            continue
        parts = {
            # On a chosen topic, whichever generator found it.
            "topic_match": 1.0 if fact.topics & user.topics else 0.0,
            "level_fit": _level_fit(fact.difficulty, user.level),
            "quality": (fact.quality - 1) / 4 if fact.quality is not None else 0.5,
            "freshness": _freshness(fact.published_at, now, config.half_life_days),
            "time_fit": _time_fit(fact.minutes, user.break_length),
        }
        weighted = {name: config.weights[name] * value for name, value in parts.items()}
        avoided = (
            len(fact.concepts & user.avoided_concepts) / len(fact.concepts)
            if fact.concepts
            else 0.0
        )
        penalty = (
            config.penalties["less_like_this"]
            * (1.0 if fact.item_id in user.less_liked else 0.0)
            + config.penalties["not_interested_concepts"] * avoided
        )
        top = max(weighted, key=lambda name: weighted[name])
        scored.append(
            Scored(
                candidate.moment_id,
                candidate.item_id,
                candidate.source_id,
                sum(weighted.values()) - penalty,
                top,
            )
        )
    return scored


def _similarity(a: MomentFacts, b: MomentFacts) -> float:
    if a.item_id == b.item_id:
        return 1.0
    union = a.concepts | b.concepts
    overlap = len(a.concepts & b.concepts) / len(union) if union else 0.0
    return max(overlap, 0.5 if a.source_id == b.source_id else 0.0)


def rerank(
    scored: list[Scored],
    facts: dict[int, MomentFacts],
    config: RankingConfig,
    limit: int,
) -> list[Scored]:
    remaining = sorted(scored, key=lambda s: (-s.score, s.moment_id))
    low = min((s.score for s in scored), default=0.0)
    spread = max((s.score for s in scored), default=0.0) - low
    scaled = {s.moment_id: (s.score - low) / spread if spread else 1.0 for s in scored}
    picked: list[Scored] = []
    per_source: dict[int, int] = {}
    lam = config.mmr_lambda
    while remaining and len(picked) < limit:
        allowed = [
            s
            for s in remaining
            if per_source.get(s.source_id, 0) < config.per_source_cap
        ]
        if not allowed:
            break

        def mmr(candidate: Scored) -> float:
            fact = facts[candidate.moment_id]
            nearest = max(
                (_similarity(fact, facts[p.moment_id]) for p in picked), default=0.0
            )
            return lam * scaled[candidate.moment_id] - (1 - lam) * nearest

        best = max(allowed, key=mmr)
        picked.append(best)
        remaining.remove(best)
        per_source[best.source_id] = per_source.get(best.source_id, 0) + 1
    return picked
