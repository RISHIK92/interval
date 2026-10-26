"""A user's ranked feed (REC-1..REC-3, P1-W4-S03): candidates, scored by the rules in
`ranking_config`, re-ranked for diversity and the per-source cap. The precomputed feed
(W4-S04) stores the result.
"""

from datetime import datetime

from interval_jobs.ports import Store
from interval_jobs.ranking.candidates import candidates
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
    inputs = store.ranking
    preferences = inputs.preferences(user_id)
    if preferences is None:
        return []
    found = candidates(store, user_id, model)
    if not found:
        return []
    facts = inputs.moment_facts([c.moment_id for c in found])
    user = UserSignals(
        topics=frozenset(preferences.topics),
        level=preferences.level,
        break_length=preferences.break_length,
        less_liked=frozenset(inputs.less_liked(user_id)),
        avoided_concepts=inputs.avoided_concepts(user_id),
    )
    config = RankingConfig.from_rows(inputs.config())
    return rerank(score(found, facts, user, config, now), facts, config, limit)
