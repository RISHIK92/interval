"""Precomputed feeds (CACHE-1, Q-P1-17, ADR-0008, P1-W4-S04): the worker ranks and
stores each user's feed; the web app only reads it. Works through ports (ADR-0012).

A failed recompute leaves the stored feed as it was and logs `feed: recompute failed`,
which the AWS stack counts (LOAD-5); the queue retries it, then the DLQ holds it.
"""

import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import get_args

from interval_db.generated import Difficulty, Topic
from interval_jobs import log
from interval_jobs.feed.project_notes import PROJECT_NOTES_PER_RECOMPUTE
from interval_jobs.feed.reasons import concept_map, explain
from interval_jobs.ports import (
    JobQueue,
    RankedEntry,
    Store,
    UserPreferences,
)
from interval_jobs.ranking.rank import (
    TOPICS,
    goal_sets,
    rank_for_preferences,
    rank_for_user,
)
from interval_jobs.ranking.scoring import Scored

FEED_LIMIT = 50
# Owner, 2026-10-26: active = an auth session used in the last 7 days. Better Auth moves
# updated_at at most once a day (updateAge), so in practice this is 6 to 7 days.
ACTIVE_DAYS = 7
LEVELS: tuple[Difficulty, ...] = get_args(Difficulty.__value__)


@dataclass
class Recomputed:
    entries: int
    # P2-W12-S05: items on the user's projects still without a line for the
    # repositories matching them now, highest-ranked first.
    project_notes: list[int] = field(default_factory=list[int])


def _with_reasons(
    store: Store,
    ranked: list[Scored],
    preferences: UserPreferences,
    now: datetime,
    done: Recomputed,
    user_id: str | None,
) -> list[RankedEntry]:
    """The entries with their one explanation (ADR-0027). A starter feed has no user:
    no goals, projects or repositories, so it states none of them."""
    projects = store.ranking.project_concepts(user_id) if user_id else {}
    repositories = store.ranking.project_repositories(user_id) if user_id else {}
    goals = goal_sets(store.ranking, preferences, projects) if user_id else ()
    concepts = concept_map(store.concepts.state())
    entries: list[RankedEntry] = []
    for s in ranked:
        found = explain(s, now, goals, projects, repositories, concepts)
        entries.append(
            RankedEntry(
                s.item_id,
                s.top_signal,
                found.text,
                s.arm,
                s.breakdown,
                () if found.kind is None else (found.kind,),
                s.facts.difficulty,
            )
        )
    done.entries += len(entries)
    return entries


def recompute_user_feed(
    store: Store,
    user_id: str,
    model: str | None,
    now: datetime,
    rng: random.Random | None = None,
) -> Recomputed:
    """Ranks the user's feed and stores it whole (one list, ADR-0058). A user without
    preferences gets an empty feed, still stored, so the web stops waiting for it."""
    done = Recomputed(0)
    try:
        # Before ranking: a recompute running alongside finishes first, and this one
        # then ranks on whatever it committed (feedback included, Q-P1-17).
        store.feed.hold_user(user_id)
        ranked = rank_for_user(store, user_id, model, now, FEED_LIMIT, rng)
        preferences = store.ranking.preferences(user_id)
        entries = (
            _with_reasons(store, ranked, preferences, now, done, user_id)
            if preferences
            else []
        )
        store.feed.replace_user(user_id, entries, now)
        # Highest-ranked first.
        on_projects = [
            e.item_id
            for e in entries
            if e.breakdown and e.breakdown.values.get("project_match", 0) > 0
        ]
        if on_projects:
            done.project_notes = store.github.project_notes_missing(
                user_id, on_projects, PROJECT_NOTES_PER_RECOMPUTE
            )
    except Exception as error:
        log.error("feed: recompute failed", user_id=user_id, error=error)
        raise
    return done


STARTERS: tuple[tuple[Topic, Difficulty], ...] = tuple(
    (topic, level) for topic in TOPICS for level in LEVELS
)


def recompute_starter(
    store: Store, topic: Topic, level: Difficulty, model: str | None, now: datetime
) -> Recomputed:
    """The starter feed of one topic and level (ADR-0008). Every topic, not only those
    the concept graph uses now, so a topic it drops is emptied."""
    done = Recomputed(0)
    preferences = UserPreferences(topics=[topic], level=level)
    try:
        ranked = rank_for_preferences(store, preferences, None, model, now, FEED_LIMIT)
        store.feed.replace_starter(
            topic, level, _with_reasons(store, ranked, preferences, now, done, None)
        )
    except Exception as error:
        log.error("feed: recompute failed", topic=topic, level=level, error=error)
        raise
    return done


def enqueue_recomputes(store: Store, queue: JobQueue, now: datetime) -> int:
    """Queues one recompute per active user. The key is per UTC hour, so a run repeated
    within the hour asks for the same job (deduplicated where the engine can)."""
    hour = now.strftime("%Y%m%d%H")
    users = store.feed.active_users(now - timedelta(days=ACTIVE_DAYS))
    for user_id in users:
        queue.enqueue(
            "recompute_feed",
            {"user_id": user_id},
            idempotency_key=f"recompute-{user_id}-{hour}",
        )
    return len(users)
