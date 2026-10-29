"""Precomputed feeds (CACHE-1, Q-P1-17, ADR-0008, P1-W4-S04): the worker ranks and
stores each user's feed; the web app only reads it. Works through ports (ADR-0012).

A failed recompute leaves the stored feed as it was and logs `feed: recompute failed`,
which the AWS stack counts (LOAD-5); the queue retries it, then the DLQ holds it.
"""

import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import get_args

from interval_db.generated import BreakLength, Difficulty, Topic
from interval_jobs import log
from interval_jobs.feed.explain import concept_map, explain
from interval_jobs.feed.project_notes import PROJECT_NOTES_PER_RECOMPUTE
from interval_jobs.ports import (
    JobQueue,
    NoteKey,
    RankedEntry,
    Store,
    UserPreferences,
)
from interval_jobs.ranking.rank import (
    TOPICS,
    Ranked,
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
# Only fills the required field: ranking replaces it with each chip's own break.
STARTER_BREAK: BreakLength = "3-8"


@dataclass
class Recomputed:
    entries: int
    # P2-W12-S05: items on the user's projects still without a line for the
    # repositories matching them now, highest-ranked first.
    project_notes: list[int] = field(default_factory=list[int])


def _with_notes(
    store: Store,
    ranked: Ranked,
    preferences: UserPreferences,
    now: datetime,
    done: Recomputed,
    user_id: str | None,
) -> dict[BreakLength, list[RankedEntry]]:
    """Every chip's entries with their explanation, if any (ADR-0025): a note is
    written the first time its key comes up and reused after. One write for the
    whole feed, so recomputes sharing notes take them in one order."""
    projects = store.ranking.project_concepts(user_id) if user_id else {}
    goals = goal_sets(store.ranking, preferences, projects)
    concepts = concept_map(store.concepts.state())
    keyed: dict[BreakLength, list[tuple[Scored, tuple[NoteKey, str] | None]]] = {
        chip: [
            (
                s,
                explain(
                    s,
                    preferences.topics,
                    preferences.level,
                    now,
                    goals,
                    projects,
                    concepts,
                ),
            )
            for s in scored
        ]
        for chip, scored in ranked.items()
    }
    notes = store.notes.ensure_all(
        {found[0]: found[1] for rows in keyed.values() for _, found in rows if found}
    )
    by_chip: dict[BreakLength, list[RankedEntry]] = {}
    for chip, rows in keyed.items():
        entries: list[RankedEntry] = []
        for s, found in rows:
            note_id = notes[found[0]] if found else None
            entries.append(
                RankedEntry(
                    s.item_id,
                    s.moment_id,
                    s.top_signal,
                    note_id,
                    s.arm,
                    s.breakdown,
                )
            )
        by_chip[chip] = entries
        done.entries += len(entries)
    return by_chip


def recompute_user_feed(
    store: Store,
    user_id: str,
    model: str | None,
    now: datetime,
    rng: random.Random | None = None,
) -> Recomputed:
    """Ranks the user's feed for every chip and stores it whole. A user without
    preferences gets empty feeds, still stored, so the web stops waiting for them."""
    done = Recomputed(0)
    try:
        # Before ranking: a recompute running alongside finishes first, and this one
        # then ranks on whatever it committed (feedback included, Q-P1-17).
        store.feed.hold_user(user_id)
        ranked = rank_for_user(store, user_id, model, now, FEED_LIMIT, rng)
        preferences = store.ranking.preferences(user_id)
        by_chip: dict[BreakLength, list[RankedEntry]] = (
            _with_notes(store, ranked, preferences, now, done, user_id)
            if preferences
            else {chip: [] for chip in ranked}
        )
        store.feed.replace_user(user_id, by_chip, now)
        # Best position in any chip first: the highest-ranked across the chips.
        best: dict[int, int] = {}
        for entries in by_chip.values():
            for position, e in enumerate(entries):
                if e.breakdown and e.breakdown.values.get("project_match", 0) > 0:
                    best[e.item_id] = min(position, best.get(e.item_id, position))
        if best:
            done.project_notes = store.github.project_notes_missing(
                user_id, sorted(best, key=best.__getitem__), PROJECT_NOTES_PER_RECOMPUTE
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
    """The starter feeds of one topic and level, every chip (ADR-0008). Every topic,
    not only those the concept graph uses now, so a topic it drops is emptied."""
    done = Recomputed(0)
    preferences = UserPreferences(
        topics=[topic], level=level, break_length=STARTER_BREAK
    )
    try:
        ranked = rank_for_preferences(store, preferences, None, model, now, FEED_LIMIT)
        for chip, entries in _with_notes(
            store, ranked, preferences, now, done, None
        ).items():
            store.feed.replace_starter(topic, level, chip, entries)
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
