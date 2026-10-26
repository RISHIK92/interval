"""A user's ranked feed (REC-1..REC-3, P1-W4-S03): candidates, scored by the rules in
`ranking_config`, re-ranked for diversity and the per-source cap. The precomputed feed
(W4-S04) stores the result.

One ranking per time chip (Q-P1-16, W4-S05), scored with that chip's time fit. 1-3 and
3-8 hold the moments that fit within their upper bound. 8-15 holds whole articles of
any length (one of unknown length too, Q-P1-39) and the moments up to 15 minutes of
articles too long to fit; an article that fits is offered whole, not as its moments
(owner, 2026-10-26).
"""

import random
from dataclasses import dataclass, replace
from datetime import datetime
from typing import get_args

from interval_db.generated import BreakLength, Topic
from interval_jobs.ports import Arm, EntryFacts, EntryKey, Store, UserPreferences
from interval_jobs.ranking.candidates import (
    Candidate,
    article_candidates,
    candidates_for,
)
from interval_jobs.ranking.explore import explore
from interval_jobs.ranking.scoring import (
    BREAK_MINUTES,
    RankingConfig,
    Scored,
    UserSignals,
    rerank,
    score,
)

Ranked = dict[BreakLength, list[Scored]]
WHOLE_ARTICLE_CHIP: BreakLength = "8-15"  # Q-P1-16
TOPICS: tuple[Topic, ...] = get_args(Topic.__value__)  # the enum's order


def _empty() -> Ranked:
    return {chip: [] for chip in BREAK_MINUTES}


def _whole_articles(
    moments: list[Candidate], articles: list[Candidate], by_item: dict[int, EntryFacts]
) -> tuple[list[Candidate], set[int]]:
    """The 8-15 chip's whole articles, and the items it offers only whole: those that
    fit. A moment's article that fits is added even when the article search missed it
    (found by similarity, or past its limit), so it isn't lost from 8-15."""
    upper = BREAK_MINUTES[WHOLE_ARTICLE_CHIP][1]
    fitting = {
        item
        for item, f in by_item.items()
        if f.minutes is not None and f.minutes <= upper
    }
    whole = {c.item_id: c for c in articles}
    for moment in moments:
        if moment.item_id in fitting and moment.item_id not in whole:
            whole[moment.item_id] = Candidate(
                None,
                moment.item_id,
                moment.source_id,
                set(moment.generators),
                moment.similarity,
            )
    return list(whole.values()), fitting


def rank_for_user(
    store: Store,
    user_id: str,
    model: str | None,
    now: datetime,
    limit: int,
    rng: random.Random | None = None,
) -> Ranked:
    preferences = store.ranking.preferences(user_id)
    if preferences is None:
        return _empty()
    return rank_for_preferences(store, preferences, user_id, model, now, limit, rng)


@dataclass
class _ChipCandidates:
    by_chip: dict[BreakLength, list[Candidate]]
    facts: dict[EntryKey, EntryFacts]


def _candidates(
    store: Store, preferences: UserPreferences, user_id: str | None, model: str | None
) -> _ChipCandidates | None:
    """Each chip's candidates on the preferences' topics, and their facts."""
    inputs = store.ranking
    moments = candidates_for(store, preferences, user_id, model)
    articles = article_candidates(store, preferences, user_id)
    if not moments and not articles:
        return None
    by_moment = inputs.moment_facts(
        [c.moment_id for c in moments if c.moment_id is not None]
    )
    # Every candidate's item: 8-15 needs its length to tell whether it fits whole.
    by_item = inputs.article_facts(sorted({c.item_id for c in moments + articles}))
    facts: dict[EntryKey, EntryFacts] = {
        f.key: f for f in [*by_moment.values(), *by_item.values()]
    }
    whole, whole_items = _whole_articles(moments, articles, by_item)
    by_chip: dict[BreakLength, list[Candidate]] = {}
    for chip, (_, upper) in BREAK_MINUTES.items():

        def fits(candidate: Candidate, upper: int = upper) -> bool:
            # A moment gone since the candidate read stays in: score() logs and skips.
            fact = facts.get(candidate.key)
            return fact is None or fact.minutes is None or fact.minutes <= upper

        chosen = [c for c in moments if fits(c)]
        if chip == WHOLE_ARTICLE_CHIP:
            chosen = whole + [c for c in chosen if c.item_id not in whole_items]
        by_chip[chip] = chosen
    return _ChipCandidates(by_chip, facts)


def rank_for_preferences(
    store: Store,
    preferences: UserPreferences,
    user_id: str | None,
    model: str | None,
    now: datetime,
    limit: int,
    rng: random.Random | None = None,
) -> Ranked:
    """With no user, a starter feed (ADR-0008): no feedback, no similarity anchors, and
    no exploration (there is no one to explore for)."""
    inputs = store.ranking
    config = RankingConfig.from_rows(inputs.config())
    main = _candidates(store, preferences, user_id, model)
    unchosen = [t for t in TOPICS if t not in preferences.topics]
    exploring = user_id is not None and config.explore_share > 0
    # Adjacent topics by topic match only: similarity anchors serve the main feed.
    adjacent = (
        _candidates(store, replace(preferences, topics=unchosen), user_id, None)
        if exploring and unchosen
        else None
    )
    if main is None and adjacent is None:
        return _empty()
    facts = {**(main.facts if main else {}), **(adjacent.facts if adjacent else {})}
    user = UserSignals(
        topics=frozenset(preferences.topics),
        level=preferences.level,
        break_length=preferences.break_length,
        less_liked=frozenset(inputs.less_liked(user_id)) if user_id else frozenset(),
        avoided_concepts=inputs.avoided_concepts(user_id) if user_id else frozenset(),
    )
    outcomes = inputs.arm_outcomes() if exploring else {}
    draw = rng or random.Random()
    ranked = _empty()
    for chip in BREAK_MINUTES:
        signals = replace(user, break_length=chip)
        scored = score(main.by_chip[chip] if main else [], facts, signals, config, now)
        if not exploring:
            ranked[chip] = rerank(scored, facts, config, limit)
            continue
        slots = int(limit * config.explore_share)
        # Greedy, so the first limit - slots are the main picks; the rest refill any
        # slot exploration can't fill.
        full = rerank(scored, facts, config, limit)
        picked = full[: limit - slots]
        # REC-4 arms: sources the user's picks don't reach, and unchosen topics.
        reached = {s.source_id for s in picked}
        pool: dict[Arm, list[Scored]] = {}
        for s in scored:
            if s.source_id not in reached:
                pool.setdefault(Arm("source", str(s.source_id)), []).append(s)
        if adjacent is not None:
            for s in score(adjacent.by_chip[chip], facts, signals, config, now):
                if s.facts.topics & user.topics:
                    continue  # on a chosen topic too: a main candidate, not adjacent
                topic = next((t for t in unchosen if t in s.facts.topics), None)
                if topic is not None:
                    pool.setdefault(Arm("topic", topic), []).append(s)
        feed = explore(picked, pool, slots, outcomes, draw, config.per_source_cap)
        taken = {s.key for s in feed}
        refill = [s for s in full[limit - slots :] if s.key not in taken]
        ranked[chip] = feed + refill[: limit - len(feed)]
    return ranked
