"""P5-W31-S04b-2 (§6.9, Q-P5-17): battle snapshots are pruned after 90 days, unless a
flag on their match still waits for review."""

from datetime import UTC, datetime, timedelta

import psycopg
import pytest

from interval_jobs.adapters.memory import InMemoryFiles
from interval_jobs.adapters.postgres import PostgresSnapshots
from interval_jobs.snapshots import BATCH, prune_snapshots
from tests.test_match_results import a_battle, a_user

NOW = datetime(2026, 11, 13, 3, 0, tzinfo=UTC)


class FakeSnapshots:
    def __init__(self, keys: list[str]) -> None:
        self.keys = keys
        self.before: datetime | None = None

    def due(self, before: datetime, limit: int) -> list[str]:
        self.before = before
        return self.keys[:limit]

    def forget(self, keys: list[str]) -> None:
        self.keys = [k for k in self.keys if k not in keys]


def test_objects_then_rows_go_in_batches() -> None:
    keys = [f"battle-snapshots/m/u/{n}.json" for n in range(BATCH + 3)]
    files = InMemoryFiles()
    for key in keys:
        files.put(key, b"{}", "application/json")
    files.put("books/kept.pdf", b"%PDF", "application/pdf")
    snapshots = FakeSnapshots(keys)
    assert prune_snapshots(snapshots, files, NOW) == BATCH + 3
    assert snapshots.before == NOW - timedelta(days=90)
    assert snapshots.keys == []
    assert list(files.stored) == ["books/kept.pdf"]
    # Nothing left: a second run removes nothing.
    assert prune_snapshots(snapshots, files, NOW) == 0


def test_a_failed_removal_keeps_the_rows() -> None:
    class Failing(InMemoryFiles):
        def remove(self, key: str) -> None:
            raise OSError("bucket down")

    snapshots = FakeSnapshots(["k1"])
    with pytest.raises(OSError):
        prune_snapshots(snapshots, Failing(), NOW)
    assert snapshots.keys == ["k1"]


def _snapshot(conn: psycopg.Connection, match_id: str, user: str, days: int) -> str:
    taken = NOW - timedelta(days=days)
    key = f"battle-snapshots/{match_id}/{user}/{taken.isoformat()}.json"
    conn.execute(
        "insert into battle_snapshot (match_id, user_id, taken_at, language, key, "
        "slot) values (%s, %s, %s, 'go', %s, %s)",
        (match_id, user, taken, key, int(taken.timestamp()) // 25),
    )
    return key


def test_due_after_90_days_unless_a_flag_waits(conn: psycopg.Connection) -> None:
    for user in ("psa", "psb", "psc"):
        a_user(conn, user)
    plain = a_battle(conn, ["psa"])
    pending = a_battle(conn, ["psb"])
    decided = a_battle(conn, ["psc"])
    old = _snapshot(conn, plain, "psa", 91)
    recent = _snapshot(conn, plain, "psa", 89)
    waiting = _snapshot(conn, pending, "psb", 120)
    reviewed = _snapshot(conn, decided, "psc", 100)
    conn.execute(
        "insert into fair_play_flag (match_id, user_id, signals) values (%s, 'psb', 1)",
        (pending,),
    )
    conn.execute(
        "insert into fair_play_flag (match_id, user_id, signals, decision, "
        "decided_at) values (%s, 'psc', 1, 'dismissed', now())",
        (decided,),
    )
    # P5-W35 (Q-P5-22): a best submission goes by the same rule.
    best = f"battle-best/{plain}/psa.json"
    conn.execute(
        "insert into battle_best_submission (match_id, user_id, language, key,"
        " taken_at) values (%s, 'psa', 'go', %s, %s)",
        (plain, best, NOW - timedelta(days=95)),
    )
    snapshots = PostgresSnapshots(conn)
    before = NOW - timedelta(days=90)
    due = set(snapshots.due(before, 10_000)) & {old, recent, waiting, reviewed, best}
    assert due == {old, reviewed, best}
    snapshots.forget([best])
    assert conn.execute(
        "select count(*) from battle_best_submission where key = %s", (best,)
    ).fetchone() == (0,)
    snapshots.forget([old])
    assert old not in snapshots.due(before, 10_000)
