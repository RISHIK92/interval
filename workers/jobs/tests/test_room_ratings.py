"""P5-W32-S01b (MATCH-1, Q-P5-18): rooms of 3 or 4 rated with OpenSkill."""

import pytest

from interval_jobs.room_ratings import (
    SKILL_START,
    Placed,
    Skill,
    ranks,
    rate_room,
    room_season_reset,
)


def test_points_then_time_ties_share_and_the_abandoned_are_last() -> None:
    assert ranks(
        [
            Placed("late", 700, 900, False),
            Placed("gone1", 900, 100, True),
            Placed("best", 1000, 800, False),
            Placed("early", 700, 500, False),
            Placed("same", 700, 900, False),
            Placed("gone2", 0, 0, True),
        ]
    ) == {"best": 1, "early": 2, "late": 3, "same": 3, "gone1": 5, "gone2": 5}


def test_a_room_moves_the_winner_up_the_last_down_and_ties_together() -> None:
    before = {u: SKILL_START for u in ("a", "b", "c", "d")}
    after = rate_room(before, {"a": 1, "b": 2, "c": 2, "d": 4})
    assert after["a"].mu > SKILL_START.mu > after["d"].mu
    assert after["b"] == after["c"]
    assert all(s.sigma < SKILL_START.sigma for s in after.values())


def test_a_season_reset_keeps_three_quarters_and_widens_sigma() -> None:
    assert (SKILL_START.mu, SKILL_START.sigma) == (25, pytest.approx(25 / 3))
    reset = room_season_reset(Skill(33, 1.0))
    assert reset.mu == pytest.approx(31)
    assert reset.sigma == pytest.approx(25 / 3 * 150 / 350)
    kept = room_season_reset(Skill(20, 6.0))
    assert (kept.mu, kept.sigma) == (pytest.approx(21.25), 6.0)
