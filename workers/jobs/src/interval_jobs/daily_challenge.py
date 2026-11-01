"""The daily challenge's day start (P3-W13-S05, Q-P3-06, ADR-0031).

`daily-challenge-due` runs at 00:00 UTC (EventBridge Scheduler or the VM's
interval-daily.timer): today's set goes out whether or not the owner approved it, and
an unapproved one's questions join the spot-check queue; then tomorrow's set is picked
for the owner's review. Idempotent, so a late or repeated run catches up: today is
picked too if no run picked it the day before.
"""

from datetime import UTC, datetime, timedelta
from typing import TypedDict

from interval_jobs import log
from interval_jobs.ports import Store


class DailyRun(TypedDict):
    picked_today: bool
    published_unreviewed: int | None  # questions newly queued for spot check
    picked_tomorrow: bool


def run_daily(store: Store, now: datetime) -> DailyRun:
    today = now.astimezone(UTC).date()
    picked_today = store.daily.pick(today)
    queued = store.daily.publish_unreviewed(today)
    if queued is not None:
        # ADR-0031: the owner sees it on /admin/daily; observable here (LOAD-5).
        log.warn(
            "daily: published unreviewed", day=today.isoformat(), queued=len(queued)
        )
    return {
        "picked_today": picked_today,
        "published_unreviewed": None if queued is None else len(queued),
        "picked_tomorrow": store.daily.pick(today + timedelta(days=1)),
    }
