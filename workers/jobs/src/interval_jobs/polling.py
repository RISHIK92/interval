"""Adaptive polling (ING-3): each source is polled at an interval that follows its
publishing rate, and `poll-due` queues the sources whose turn has come.

A poll that finds new items halves the interval; one that finds none (a 304 included)
lengthens it by half. Bounds: 15 minutes, so a busy blog is never hammered, and 24
hours, so a quiet one is still seen daily. The numbers are overnight picks (2026-10-26),
flagged for the owner.

EventBridge Scheduler (AWS) or a systemd timer (VM) runs `poll-due` every 5 minutes.
"""

from datetime import datetime, timedelta

from interval_jobs.ports import JobQueue, Store

MIN_INTERVAL = timedelta(minutes=15)
MAX_INTERVAL = timedelta(hours=24)
START_INTERVAL = timedelta(hours=1)  # the column default in the poll_schedule migration


def next_interval(current: timedelta, new_items: int) -> timedelta:
    proposed = current / 2 if new_items > 0 else current * 1.5
    # Whole seconds, as the column stores them.
    seconds = round(proposed.total_seconds())
    return min(MAX_INTERVAL, max(MIN_INTERVAL, timedelta(seconds=seconds)))


def enqueue_due(store: Store, queue: JobQueue, now: datetime) -> int:
    """Claims every due source (its next turn moves one interval on, so a discover
    that is lost is retried then) and queues a discover for each. Call it inside the
    unit of work: if an enqueue fails, the claims roll back, and the next run queues
    those sources again. Delivery is at least once; discover adapts the interval only
    once per turn, so a duplicate costs one extra feed request."""
    minute = int(now.timestamp()) // 60
    claimed = store.sources.claim_due(now)
    for source_id in claimed:
        queue.enqueue(
            "discover_source",
            {"source_id": source_id},
            idempotency_key=f"discover-{source_id}-{minute}",
        )
    return len(claimed)
