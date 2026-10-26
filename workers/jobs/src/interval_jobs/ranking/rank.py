"""A user's ranked feed (REC-1..REC-3, P1-W4-S03): candidates, scored by the rules in
`ranking_config`, re-ranked for diversity and the per-source cap. The precomputed feed
(W4-S04) stores the result.
"""

from datetime import datetime

from interval_jobs.ports import Store, UserPreferences
from interval_jobs.ranking.candidates import candidates_for
from interval_jobs.ranking.scoring import (
    RankingConfig,
    Scored,
    UserSignals,
    rerank,
    score,
)


def rank_for_user(
    store: Store, user_id: str, model: str | None, now: datetime, limit: int
) -> list[Scored]:
    preferences = store.ranking.preferences(user_id)
    if preferences is None:
        return []
    return rank_for_preferences(store, preferences, user_id, model, now, limit)


def rank_for_preferences(
    store: Store,
    preferences: UserPreferences,
    user_id: str | None,
    model: str | None,
    now: datetime,
    limit: int,
) -> list[Scored]:
    """With no user, a starter feed (ADR-0008): no feedback, no similarity anchors."""
    inputs = store.ranking
    found = candidates_for(store, preferences, user_id, model)
    if not found:
        return []
    facts = inputs.moment_facts([c.moment_id for c in found])
    user = UserSignals(
        topics=frozenset(preferences.topics),
        level=preferences.level,
        break_length=preferences.break_length,
        less_liked=frozenset(inputs.less_liked(user_id)) if user_id else frozenset(),
        avoided_concepts=inputs.avoided_concepts(user_id) if user_id else frozenset(),
    )
    config = RankingConfig.from_rows(inputs.config())
    return rerank(score(found, facts, user, config, now), facts, config, limit)
