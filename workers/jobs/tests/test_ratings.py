"""Glicko-2 (MATCH-1, ADR-0034), checked against Glickman's worked example ("Example of
the Glicko-2 system", 2013, section 3)."""

import pytest

from interval_jobs.ratings import Glicko, season_reset, update


def test_glickmans_worked_example() -> None:
    player = Glicko(1500, 200, 0.06)
    after = update(
        player,
        [
            (Glicko(1400, 30, 0.06), 1.0),
            (Glicko(1550, 100, 0.06), 0.0),
            (Glicko(1700, 300, 0.06), 0.0),
        ],
    )
    assert after.rating == pytest.approx(1464.06, abs=0.01)
    assert after.rd == pytest.approx(151.52, abs=0.01)
    assert after.volatility == pytest.approx(0.05999, abs=0.00001)


def test_an_upset_takes_the_other_volatility_branch() -> None:
    # delta squared beyond phi squared plus v: step 5's B = ln(delta^2 - phi^2 - v).
    # Checked against an independent bisection of f(x) = 0.
    after = update(Glicko(1500, 50, 0.06), [(Glicko(2200, 50, 0.06), 1.0)])
    assert after.volatility == pytest.approx(0.0600124, abs=0.0000001)
    assert after.rating > 1500


def test_one_match_moves_equals_apart_by_the_same_amount() -> None:
    start = Glicko(1500, 350, 0.06)
    won = update(start, [(start, 1.0)])
    lost = update(start, [(start, 0.0)])
    drew = update(start, [(start, 0.5)])
    assert won.rating > 1500 > lost.rating
    assert won.rating - 1500 == pytest.approx(1500 - lost.rating)
    assert drew.rating == pytest.approx(1500)
    # Pinned, so a wrong but symmetric formula can't pass.
    assert won.rating == pytest.approx(1662.31, abs=0.01)
    assert won.rd == pytest.approx(290.32, abs=0.01)


# P3-W16-S06 (Q-P3-13; owner, 2026-11-03): a season's soft reset keeps 75% of the
# distance from 1500, raises RD to at least 150, and leaves volatility.
@pytest.mark.parametrize(
    ("rating", "after"), [(1900.0, 1800.0), (1100.0, 1200.0), (1500.0, 1500.0)]
)
def test_a_season_reset_keeps_three_quarters_of_the_distance(
    rating: float, after: float
) -> None:
    assert season_reset(Glicko(rating, 200, 0.06)).rating == pytest.approx(after)


def test_a_season_reset_widens_a_narrow_rd_and_keeps_volatility() -> None:
    assert season_reset(Glicko(1500, 80, 0.07)) == Glicko(1500, 150, 0.07)
    assert season_reset(Glicko(1500, 300, 0.05)).rd == 300
