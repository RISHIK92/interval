"""Glicko-2 for quick games (MATCH-1, MATCH-2, ADR-0034), as Glickman's "Example of the
Glicko-2 system" (2013) sets out. One match is one rating period (owner, 2026-11-02)."""

import math
from dataclasses import dataclass

SCALE = 173.7178  # Glicko to Glicko-2
TAU = 0.5  # how far volatility may move (owner, 2026-11-02; Glickman: 0.3 to 1.2)
EPSILON = 0.000001


@dataclass(frozen=True)
class Glicko:
    rating: float
    rd: float
    volatility: float


START = Glicko(1500, 350, 0.06)  # owner, 2026-11-02: Glickman's defaults


def _g(phi: float) -> float:
    return 1 / math.sqrt(1 + 3 * phi**2 / math.pi**2)


def _e(mu: float, mu_j: float, phi_j: float) -> float:
    return 1 / (1 + math.exp(-_g(phi_j) * (mu - mu_j)))


def update(player: Glicko, games: list[tuple[Glicko, float]]) -> Glicko:
    """The player's rating after a rating period of `games` (opponent, score 0 to 1),
    each opponent as they stood before it. A period is always one match (owner,
    2026-11-02), so an idle player's RD doesn't widen with time."""
    mu = (player.rating - 1500) / SCALE
    phi = player.rd / SCALE
    sigma = player.volatility

    opponents = [((o.rating - 1500) / SCALE, o.rd / SCALE, score) for o, score in games]
    v = 1 / sum(
        _g(phi_j) ** 2 * _e(mu, mu_j, phi_j) * (1 - _e(mu, mu_j, phi_j))
        for mu_j, phi_j, _ in opponents
    )
    delta = v * sum(
        _g(phi_j) * (score - _e(mu, mu_j, phi_j)) for mu_j, phi_j, score in opponents
    )

    # Step 5: the new volatility, by the Illinois algorithm.
    a = math.log(sigma**2)

    def f(x: float) -> float:
        ex = math.exp(x)
        return (
            ex * (delta**2 - phi**2 - v - ex) / (2 * (phi**2 + v + ex) ** 2)
            - (x - a) / TAU**2
        )

    big_a = a
    if delta**2 > phi**2 + v:
        big_b = math.log(delta**2 - phi**2 - v)
    else:
        k = 1
        while f(a - k * TAU) < 0:
            k += 1
        big_b = a - k * TAU
    f_a, f_b = f(big_a), f(big_b)
    while abs(big_b - big_a) > EPSILON:
        big_c = big_a + (big_a - big_b) * f_a / (f_b - f_a)
        f_c = f(big_c)
        if f_c * f_b <= 0:
            big_a, f_a = big_b, f_b
        else:
            f_a /= 2
        big_b, f_b = big_c, f_c
    new_sigma = math.exp(big_a / 2)

    # Steps 6 to 8.
    phi_star = math.sqrt(phi**2 + new_sigma**2)
    new_phi = 1 / math.sqrt(1 / phi_star**2 + 1 / v)
    new_mu = mu + new_phi**2 * sum(
        _g(phi_j) * (score - _e(mu, mu_j, phi_j)) for mu_j, phi_j, score in opponents
    )
    return Glicko(new_mu * SCALE + 1500, new_phi * SCALE, new_sigma)


# P3-W16-S06 (Q-P3-13; owner, 2026-11-03): a season's soft reset.
SEASON_KEEPS = 0.75  # of the distance from the starting rating
SEASON_MIN_RD = 150.0  # so a season's first matches move ratings faster


def season_reset(player: Glicko) -> Glicko:
    """The rating a player starts the next season on: three quarters of the way from
    1500, RD at least 150, volatility as it was."""
    return Glicko(
        START.rating + SEASON_KEEPS * (player.rating - START.rating),
        max(player.rd, SEASON_MIN_RD),
        player.volatility,
    )
