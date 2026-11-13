"""OpenSkill for rooms (MATCH-1, C-03; Q-P5-11, Q-P5-18; P5-W32-S01b): a battle of 3 or
4 players is rated with the Plackett-Luce model, apart from 1v1 battles' Glicko-2 and
quick games'. One match is one update."""

from dataclasses import dataclass

from openskill.models import PlackettLuce

from interval_jobs.ratings import SEASON_KEEPS, SEASON_MIN_RD, START

_MODEL = PlackettLuce()


@dataclass(frozen=True)
class Skill:
    mu: float
    sigma: float


SKILL_START = Skill(_MODEL.mu, _MODEL.sigma)  # openskill's defaults: 25, 25/3


@dataclass(frozen=True)
class Placed:
    user: str
    total: int  # the best submission's points
    # When it was reached: earlier breaks a tie. The game server gives a player who
    # never submitted the battle's full length, so they trail any equal score.
    time_ms: int
    abandoned: bool


def ranks(players: list[Placed]) -> dict[str, int]:
    """Q-P5-18: by points, then time; equal points and time share a rank, and every
    abandoned player shares the last. Ranks are 1-based and competition-style (1, 2, 2,
    4)."""
    order = sorted(players, key=lambda p: (p.abandoned, -p.total, p.time_ms))
    out: dict[str, int] = {}
    for i, p in enumerate(order):
        prev = order[i - 1] if i else None
        same = prev is not None and (
            (p.abandoned and prev.abandoned)
            or (
                not p.abandoned
                and not prev.abandoned
                and (p.total, p.time_ms) == (prev.total, prev.time_ms)
            )
        )
        out[p.user] = out[prev.user] if same and prev is not None else i + 1
    return out


def rate_room(before: dict[str, Skill], rank: dict[str, int]) -> dict[str, Skill]:
    """Each player's skill after the room, each team a single player."""
    users = sorted(before)
    teams = [[_MODEL.rating(mu=before[u].mu, sigma=before[u].sigma)] for u in users]
    rated = _MODEL.rate(teams, ranks=[float(rank[u]) for u in users])
    return {
        u: Skill(team[0].mu, team[0].sigma)
        for u, team in zip(users, rated, strict=True)
    }


def room_season_reset(skill: Skill) -> Skill:
    """The quick games' soft reset in OpenSkill's terms: three quarters of the way from
    the starting mu, and sigma at least the share of the start that RD 150 is of 350."""
    return Skill(
        SKILL_START.mu + SEASON_KEEPS * (skill.mu - SKILL_START.mu),
        max(skill.sigma, SKILL_START.sigma * SEASON_MIN_RD / START.rd),
    )
