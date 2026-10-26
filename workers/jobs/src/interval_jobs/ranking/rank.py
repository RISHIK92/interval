"""A user's ranked feed (REC-1..REC-3, P1-W4-S03): candidates, scored by the rules in
`ranking_config`, re-ranked for diversity and the per-source cap. The precomputed feed
(W4-S04) stores the result.

One ranking per time chip (Q-P1-16, W4-S05), scored with that chip's time fit. 1-3 and
3-8 hold the moments that fit within their upper bound. 8-15 holds whole articles of
any length (one of unknown length too, Q-P1-39) and the moments up to 15 minutes of
articles too long to fit; an article that fits is offered whole, not as its moments
(owner, 2026-10-26).
"""

from dataclasses import replace
from datetime import datetime

from interval_db.generated import BreakLength
from interval_jobs.ports import EntryFacts, EntryKey, Store, UserPreferences
from interval_jobs.ranking.candidates import (
    Candidate,
    article_candidates,
    candidates_for,
)
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
    store: Store, user_id: str, model: str | None, now: datetime, limit: int
) -> Ranked:
    preferences = store.ranking.preferences(user_id)
    if preferences is None:
        return _empty()
    return rank_for_preferences(store, preferences, user_id, model, now, limit)


def rank_for_preferences(
    store: Store,
    preferences: UserPreferences,
    user_id: str | None,
    model: str | None,
    now: datetime,
    limit: int,
) -> Ranked:
    """With no user, a starter feed (ADR-0008): no feedback, no similarity anchors."""
    inputs = store.ranking
    moments = candidates_for(store, preferences, user_id, model)
    articles = article_candidates(store, preferences, user_id)
    if not moments and not articles:
        return _empty()
    by_moment = inputs.moment_facts(
        [c.moment_id for c in moments if c.moment_id is not None]
    )
    # Every candidate's item: 8-15 needs its length to tell whether it fits whole.
    by_item = inputs.article_facts(sorted({c.item_id for c in moments + articles}))
    facts: dict[EntryKey, EntryFacts] = {
        f.key: f for f in [*by_moment.values(), *by_item.values()]
    }
    user = UserSignals(
        topics=frozenset(preferences.topics),
        level=preferences.level,
        break_length=preferences.break_length,
        less_liked=frozenset(inputs.less_liked(user_id)) if user_id else frozenset(),
        avoided_concepts=inputs.avoided_concepts(user_id) if user_id else frozenset(),
    )
    config = RankingConfig.from_rows(inputs.config())
    whole, whole_items = _whole_articles(moments, articles, by_item)
    ranked = _empty()
    for chip, (_, upper) in BREAK_MINUTES.items():

        def fits(candidate: Candidate, upper: int = upper) -> bool:
            # A moment gone since the candidate read stays in: score() logs and skips.
            fact = facts.get(candidate.key)
            return fact is None or fact.minutes is None or fact.minutes <= upper

        chosen = [c for c in moments if fits(c)]
        if chip == WHOLE_ARTICLE_CHIP:
            chosen = whole + [c for c in chosen if c.item_id not in whole_items]
        scored = score(chosen, facts, replace(user, break_length=chip), config, now)
        ranked[chip] = rerank(scored, facts, config, limit)
    return ranked
