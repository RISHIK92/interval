"""A user's ranked feed (REC-1..REC-3, P1-W4-S03): candidates, scored by the rules in
`ranking_config`, re-ranked for diversity and the per-source cap. The precomputed feed
(W4-S04) stores the result: one list of articles (ADR-0058), whatever their length.
"""

import random
from dataclasses import dataclass, replace
from datetime import datetime
from typing import get_args

from interval_db.generated import LearningGoal, Topic
from interval_jobs.ports import (
    Arm,
    EntryFacts,
    ProjectConcepts,
    RankingInputs,
    Store,
    UserPreferences,
)
from interval_jobs.ranking.candidates import Candidate, candidates_for
from interval_jobs.ranking.explore import explore
from interval_jobs.ranking.scoring import (
    RankingConfig,
    Scored,
    UserSignals,
    rerank,
    score,
)

TOPICS: tuple[Topic, ...] = get_args(Topic.__value__)  # the enum's order


def rank_for_user(
    store: Store,
    user_id: str,
    model: str | None,
    now: datetime,
    limit: int,
    rng: random.Random | None = None,
) -> list[Scored]:
    preferences = store.ranking.preferences(user_id)
    if preferences is None:
        return []
    return rank_for_preferences(store, preferences, user_id, model, now, limit, rng)


@dataclass
class _Candidates:
    found: list[Candidate]
    facts: dict[int, EntryFacts]


def _candidates(
    store: Store, preferences: UserPreferences, user_id: str | None, model: str | None
) -> _Candidates | None:
    """The candidates on the preferences' topics, and their facts."""
    found = candidates_for(store, preferences, user_id, model)
    if not found:
        return None
    facts = store.ranking.article_facts(sorted({c.item_id for c in found}))
    return _Candidates(found, facts)


def goal_sets(
    inputs: RankingInputs,
    preferences: UserPreferences,
    projects: ProjectConcepts | None = None,
) -> tuple[tuple[LearningGoal, frozenset[str]], ...]:
    """The user's goals that point at concepts, in their order (ADR-0015). "Get better
    at the stack I use" points at their projects' concepts (P2-W12-S04)."""
    sets = dict(inputs.goal_concepts(preferences.goals)) if preferences.goals else {}
    if projects:
        sets["stack-i-use"] = frozenset(projects)
    return tuple((g, sets[g]) for g in preferences.goals if sets.get(g))


def rank_for_preferences(
    store: Store,
    preferences: UserPreferences,
    user_id: str | None,
    model: str | None,
    now: datetime,
    limit: int,
    rng: random.Random | None = None,
) -> list[Scored]:
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
        return []
    facts = {**(main.facts if main else {}), **(adjacent.facts if adjacent else {})}
    projects = inputs.project_concepts(user_id) if user_id else {}
    user = UserSignals(
        topics=frozenset(preferences.topics),
        level=preferences.level,
        less_liked=frozenset(inputs.less_liked(user_id)) if user_id else frozenset(),
        avoided_concepts=inputs.avoided_concepts(user_id) if user_id else frozenset(),
        goal_sets=goal_sets(inputs, preferences, projects),
        project_concepts=frozenset(projects),
    )
    scored = score(main.found if main else [], facts, user, config, now)
    if not exploring:
        return rerank(scored, facts, config, limit)
    outcomes = inputs.arm_outcomes()
    draw = rng or random.Random()
    slots = int(limit * config.explore_share)
    # Greedy, so the first limit - slots are the main picks; the rest refill any slot
    # exploration can't fill.
    full = rerank(scored, facts, config, limit)
    picked = full[: limit - slots]
    # REC-4 arms: sources the user's picks don't reach, and unchosen topics.
    reached = {s.source_id for s in picked}
    pool: dict[Arm, list[Scored]] = {}
    for s in scored:
        if s.source_id not in reached:
            pool.setdefault(Arm("source", str(s.source_id)), []).append(s)
    if adjacent is not None:
        for s in score(adjacent.found, facts, user, config, now):
            if s.facts.topics & user.topics:
                continue  # on a chosen topic too: a main candidate, not adjacent
            topic = next((t for t in unchosen if t in s.facts.topics), None)
            if topic is not None:
                pool.setdefault(Arm("topic", topic), []).append(s)
    feed = explore(picked, pool, slots, outcomes, draw, config.per_source_cap)
    taken = {s.item_id for s in feed}
    refill = [s for s in full[limit - slots :] if s.item_id not in taken]
    return feed + refill[: limit - len(feed)]
