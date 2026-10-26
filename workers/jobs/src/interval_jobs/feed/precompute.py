"""Precomputed feeds (CACHE-1, Q-P1-17, ADR-0008, P1-W4-S04): the worker ranks and
stores each user's feed; the web app only reads it. Works through ports (ADR-0012).

A failed recompute leaves the stored feed as it was and logs `feed: recompute failed`,
which the AWS stack counts (LOAD-5); the queue retries it, then the DLQ holds it.
"""

from datetime import datetime, timedelta
from typing import get_args

from interval_db.generated import BreakLength, Difficulty, Topic
from interval_jobs import log
from interval_jobs.ports import JobQueue, RankedEntry, Store, UserPreferences
from interval_jobs.ranking.rank import Ranked, rank_for_preferences, rank_for_user
from interval_jobs.ranking.scoring import BREAK_MINUTES, Scored

FEED_LIMIT = 50
# Owner, 2026-10-26: active = an auth session used in the last 7 days. Better Auth moves
# updated_at at most once a day (updateAge), so in practice this is 6 to 7 days.
ACTIVE_DAYS = 7
LEVELS: tuple[Difficulty, ...] = get_args(Difficulty.__value__)
TOPICS: tuple[Topic, ...] = get_args(Topic.__value__)
# Only fills the required field: ranking replaces it with each chip's own break.
STARTER_BREAK: BreakLength = "3-8"


def _entries(scored: list[Scored]) -> list[RankedEntry]:
    return [RankedEntry(s.item_id, s.moment_id, s.top_signal) for s in scored]


def _by_chip(ranked: Ranked) -> dict[BreakLength, list[RankedEntry]]:
    return {chip: _entries(scored) for chip, scored in ranked.items()}


def recompute_user_feed(
    store: Store, user_id: str, model: str | None, now: datetime
) -> int:
    """Ranks the user's feed for every chip and stores it whole; returns how many
    entries. A user without preferences gets empty feeds, still stored, so the web
    stops waiting for them."""
    try:
        # Before ranking: a recompute running alongside finishes first, and this one
        # then ranks on whatever it committed (feedback included, Q-P1-17).
        store.feed.hold_user(user_id)
        ranked = rank_for_user(store, user_id, model, now, FEED_LIMIT)
        store.feed.replace_user(user_id, _by_chip(ranked), now)
    except Exception as error:
        log.error("feed: recompute failed", user_id=user_id, error=error)
        raise
    return sum(len(scored) for scored in ranked.values())


def recompute_starters(store: Store, model: str | None, now: datetime) -> int:
    """One starter feed per (topic, level, chip); returns how many. Every topic, not
    only those the concept graph uses now, so a topic it drops is emptied, not left
    stale."""
    for topic in TOPICS:
        for level in LEVELS:
            preferences = UserPreferences(
                topics=[topic], level=level, break_length=STARTER_BREAK
            )
            try:
                ranked = rank_for_preferences(
                    store, preferences, None, model, now, FEED_LIMIT
                )
                for chip, scored in ranked.items():
                    store.feed.replace_starter(topic, level, chip, _entries(scored))
            except Exception as error:
                log.error(
                    "feed: recompute failed", topic=topic, level=level, error=error
                )
                raise
    return len(TOPICS) * len(LEVELS) * len(BREAK_MINUTES)


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
