"""Invite code issuing logic (Q-P1-24) on the in-memory store."""

from datetime import UTC, datetime, timedelta

import pytest

from interval_jobs.adapters.memory import InMemoryStore
from interval_jobs.invites import (
    ALPHABET,
    CODE_LENGTH,
    display,
    issue_invites,
    new_code,
)


def test_codes_use_an_unambiguous_alphabet_and_fixed_length() -> None:
    assert len(ALPHABET) == 32
    assert not set("0O1I") & set(ALPHABET)
    for _ in range(200):
        code = new_code()
        assert len(code) == CODE_LENGTH
        assert set(code) <= set(ALPHABET)


def test_display_groups_the_code() -> None:
    assert display("ABCDEFGHJK") == "ABCDE-FGHJK"


def test_issue_returns_distinct_codes_with_the_given_settings() -> None:
    store = InMemoryStore()
    before = datetime.now(UTC)
    codes = issue_invites(
        store, group="student", uses=30, days=14, count=5, note="class A"
    )
    assert len(set(codes)) == 5
    rows = list(store.invites.rows.values())
    assert {r.code for r in rows} == set(codes)
    for row in rows:
        assert (row.beta_group, row.max_uses, row.note) == ("student", 30, "class A")
        expected = before + timedelta(days=14)
        assert abs((row.expires_at - expected).total_seconds()) < 60


@pytest.mark.parametrize(
    ("uses", "days", "count"),
    [(0, 30, 1), (1, 0, 1), (1, 30, 0), (1, 30, 501), (-1, 30, 1)],
)
def test_issue_rejects_out_of_range_input(uses: int, days: int, count: int) -> None:
    with pytest.raises(ValueError):
        issue_invites(
            InMemoryStore(), group="developer", uses=uses, days=days, count=count
        )
