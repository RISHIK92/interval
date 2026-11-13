"""P5-W31-S04b-2 (§6.9, DB-6, Q-P5-17): a battle's code snapshots are kept 90 days, or
until every fair-play flag on their match is decided, whichever is later (owner,
2026-11-13). Deleting adds a marker in the versioned bucket, and the version expires 30
days on, as books' do. Their keys are in Postgres (battle_snapshot), so the bucket is
never listed."""

from datetime import datetime, timedelta
from typing import Protocol

from interval_jobs.ports import Files

KEEP = timedelta(days=90)
BATCH = 500


class Snapshots(Protocol):
    def due(self, before: datetime, limit: int) -> list[str]:
        """Keys of snapshots taken before `before` whose match has no pending flag."""
        ...

    def forget(self, keys: list[str]) -> None: ...


def prune_snapshots(snapshots: Snapshots, files: Files, now: datetime) -> int:
    """Each object goes before its row: a run that fails midway leaves rows to retry,
    and removing an object that's already gone is no error. Idempotent."""
    removed = 0
    while keys := snapshots.due(now - KEEP, BATCH):
        for key in keys:
            files.remove(key)
        snapshots.forget(keys)
        removed += len(keys)
    return removed
