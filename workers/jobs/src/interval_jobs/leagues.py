"""Weekly leagues (ADR-0045): activity cohorts of about 30 in six tiers, separate from
every rating.

The `league_points` stage writes what one source earns, once per source and player
(LOAD-5): a finished quick game or LLD battle, a scored HLD match, a passed reading
checkpoint, or a fair-play penalty that takes a match's points back. The rules live
here only (ARCH-2): the web app and the game server just name the source.

`close-leagues-due` closes every past week still open (ranks, outcomes, tier moves) and
cuts this week's cohorts from last week's players, each once. The rank order and how
many move are the database's (the league_standing and league_cohort_moves views), so
the web app shows the same zones the close applies.

Owner-decided (ADR-0045): the cohort of about 30 "at your pace", points from matches,
battles and reading checkpoints, a new league every Monday, six tiers, top 7 up and
bottom 5 down. PROVISIONAL (the ADR's recommendation): the points table, the daily cap,
the week's zone, Bronze start, pace as last week's active days, the small-tier split,
the edges, inactive weeks, ties and guests.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from interval_db.generated import LeagueTier
from interval_jobs.events.emitter import Emitter, EventContext
from interval_jobs.ports import (
    CheckpointFacts,
    DailyFacts,
    EventSink,
    HldFacts,
    LeagueCohort,
    LeagueMemberResult,
    LeagueReturning,
    Leagues,
    LeagueSourceKind,
    LeagueUser,
    MatchFacts,
    PointsReason,
)

TIERS: tuple[LeagueTier, ...] = (
    "bronze",
    "silver",
    "gold",
    "sapphire",
    "ruby",
    "diamond",
)

# The points table (ADR-0045, PROVISIONAL).
MATCH_POINTS = 10
MATCH_WIN = 5
REPLAY_POINTS = 5  # a bot or ghost match, no win bonus
BATTLE_POINTS = 30
BATTLE_WIN = 15
CHECKPOINT_POINTS = 10
DAILY_POINTS = 5  # owner, 2026-11-26: the only solo game that earns
DAILY_CAP = 300

COHORT = 30  # "30 players at your pace"
# BATTLE_WINDOW_TIME_ZONE when it is empty (Q-P5-12).
UTC_ZONE = ZoneInfo("UTC")
ONE_COHORT_BELOW = 40  # a smaller tier is one cohort
QUICK_MODES = ("sprint", "fastest_finger")


@dataclass(frozen=True)
class Award:
    """What one player earned from one source, before the daily cap."""

    user_id: str
    points: int
    reason: PointsReason
    at: datetime
    # The ledger's source when it isn't the message's: what scores only once for a
    # player across attempts (a checkpoint, a day's challenge).
    key: str | None = None


@dataclass(frozen=True)
class Placed:
    """A player put into a cohort, for `league_placed` (DB-5)."""

    user: LeagueUser
    tier: LeagueTier
    cohort_size: int
    mid_week: bool


@dataclass(frozen=True)
class Closed:
    """A member's final standing, for `league_week_closed` (DB-5)."""

    user: LeagueUser
    tier: LeagueTier
    rank: int
    points: int
    outcome: Literal["up", "stay", "down"]


def week_start(at: datetime, zone: ZoneInfo) -> date:
    """The Monday of `at`'s week in the league's zone."""
    day = at.astimezone(zone).date()
    return day - timedelta(days=day.weekday())


def day_bounds(at: datetime, zone: ZoneInfo) -> tuple[datetime, datetime]:
    """`at`'s day in the league's zone, as [start, end): the daily cap's day."""
    day = at.astimezone(zone).date()
    start = datetime.combine(day, time(), zone)
    return start, datetime.combine(day + timedelta(days=1), time(), zone)


def match_awards(facts: MatchFacts) -> list[Award]:
    """A finished quick game earns each player 10, +5 for the winner; against a bot or
    a ghost, 5 and no bonus. A finished LLD battle earns 30, +15 for the winner. In an
    abandoned match whoever stayed earns the same without the bonus (owner,
    2026-11-26). A player who left, a cancelled or void match, a practice session and a
    seat already penalised for fair play earn nothing."""
    if facts.outcome not in ("finished", "abandoned"):
        return []
    bonus = facts.outcome == "finished"
    awards: list[Award] = []
    for seat in facts.seats:
        if seat.abandoned or seat.penalized:
            continue
        if facts.mode == "battle":
            points = BATTLE_POINTS + (BATTLE_WIN if bonus and seat.won else 0)
            awards.append(Award(seat.user_id, points, "battle", facts.finished_at))
        elif facts.mode in QUICK_MODES and facts.replay:
            awards.append(
                Award(seat.user_id, REPLAY_POINTS, "bot_match", facts.finished_at)
            )
        elif facts.mode in QUICK_MODES:
            points = MATCH_POINTS + (MATCH_WIN if bonus and seat.won else 0)
            awards.append(Award(seat.user_id, points, "match", facts.finished_at))
    return awards


def hld_awards(facts: HldFacts) -> list[Award]:
    """A scored HLD match against at least one other player earns each player who
    submitted 30, +15 for first place."""
    if len(facts.seats) < 2:
        return []
    return [
        Award(
            seat.user_id,
            BATTLE_POINTS + (BATTLE_WIN if seat.place == 1 else 0),
            "battle",
            facts.scored_at,
        )
        for seat in facts.seats
        if seat.submitted
    ]


def checkpoint_awards(facts: CheckpointFacts) -> list[Award]:
    """Only a checkpoint's first pass scores (owner, 2026-11-26): it is the key."""
    if not facts.passed:
        return []
    return [
        Award(
            facts.user_id,
            CHECKPOINT_POINTS,
            "checkpoint",
            facts.finished_at,
            facts.checkpoint,
        )
    ]


def daily_awards(facts: DailyFacts) -> list[Award]:
    """Once per challenge: its day is the key."""
    return [
        Award(
            facts.user_id,
            DAILY_POINTS,
            "daily",
            facts.finished_at,
            facts.day.isoformat(),
        )
    ]


def credit_source(
    leagues: Leagues,
    kind: LeagueSourceKind,
    source_id: str,
    zone: ZoneInfo,
) -> list[Placed]:
    """Writes what the source earned, once per player, and places a player in their
    tier's cohort with room when these are their first points of the week. Returns
    the placements, for events after the commit."""
    if kind == "fair_play":
        _take_back(leagues, source_id)
        return []
    awards = _awards(leagues, kind, source_id)
    placed: list[Placed] = []
    for award in awards:
        # Locks the player, so their cap and placement see one writer at a time.
        player = leagues.player(award.user_id)
        if player is None:
            continue  # a guest, or a plan without play.league
        start, end = day_bounds(award.at, zone)
        room = max(0, DAILY_CAP - leagues.earned(award.user_id, start, end))
        points = min(award.points, room)
        week = leagues.week(week_start(award.at, zone), zone.key)
        if not leagues.add(
            award.user_id,
            week.id,
            kind,
            award.key or source_id,
            points,
            award.reason,
            award.at,
        ):
            continue  # scored already (a redelivery)
        # A closed week's standing is corrected, but nobody joins it late; before
        # Monday's run has formed the week (and moved last week's tiers), points wait
        # and that run places their player.
        if (
            points == 0
            or week.closed
            or not week.formed
            or leagues.member(week.id, award.user_id)
        ):
            continue
        # Not placed on Monday means no points last week, so their pace is 0.
        size = leagues.place(week.id, award.user_id, player.tier, 0, COHORT)
        placed.append(Placed(player.user, player.tier, size, mid_week=True))
    return placed


def _awards(leagues: Leagues, kind: LeagueSourceKind, source_id: str) -> list[Award]:
    if kind == "match":
        facts = leagues.match(source_id)
        return [] if facts is None else match_awards(facts)
    if kind == "hld_match":
        hld = leagues.hld_match(source_id)
        return [] if hld is None else hld_awards(hld)
    if kind == "daily":
        daily = leagues.daily(source_id)
        return [] if daily is None else daily_awards(daily)
    checkpoint = leagues.checkpoint(source_id)
    return [] if checkpoint is None else checkpoint_awards(checkpoint)


def _take_back(leagues: Leagues, flag_id: str) -> None:
    """§6.9: a penalty on a human-mode match removes that match's points with a
    negative row in the week they were earned. AI-mode points stay (§6.9: no
    restrictions there); a match not yet scored is skipped when it is (match_awards)."""
    penalty = leagues.penalty(flag_id)
    if penalty is None:
        return
    credit = leagues.credited("match", penalty.match_id, penalty.user_id)
    if credit is None or credit.points <= 0:
        return
    leagues.add(
        penalty.user_id,
        credit.week_id,
        "fair_play",
        flag_id,
        -credit.points,
        "penalty",
        penalty.decided_at,
    )


def cohort_sizes(players: int) -> list[int]:
    """A tier's Monday cohorts: one below 40 players; otherwise near-equal cohorts of
    at most 30, the larger first (each at least 20)."""
    if players == 0:
        return []
    count = 1 if players < ONE_COHORT_BELOW else math.ceil(players / COHORT)
    small, extra = divmod(players, count)
    return [small + 1 if i < extra else small for i in range(count)]


def cut_cohorts(
    returning: Sequence[LeagueReturning],
) -> list[tuple[LeagueTier, list[LeagueReturning]]]:
    """Each tier's returning players sorted by pace (most active days first) and cut
    into cohorts, so each plays with people who play about as much."""
    cohorts: list[tuple[LeagueTier, list[LeagueReturning]]] = []
    for tier in TIERS:
        players = sorted(
            (r for r in returning if r.tier == tier),
            key=lambda r: (-r.pace_days, r.user.user_id),
        )
        at = 0
        for size in cohort_sizes(len(players)):
            cohorts.append((tier, players[at : at + size]))
            at += size
    return cohorts


def outcomes(cohort: LeagueCohort) -> list[LeagueMemberResult]:
    """The cohort's final ranks: the top `up` move up a tier and the bottom `down`
    move down (none past Diamond or Bronze, as the counts already say)."""
    size = len(cohort.members)
    results: list[LeagueMemberResult] = []
    for member in cohort.members:
        if member.rank <= cohort.up:
            outcome, step = "up", 1
        elif member.rank > size - cohort.down:
            outcome, step = "down", -1
        else:
            outcome, step = "stay", 0
        results.append(
            LeagueMemberResult(
                member.user,
                cohort.id,
                member.rank,
                member.points,
                outcome,
                TIERS[TIERS.index(cohort.tier) + step],
            )
        )
    return results


def close_leagues_due(
    leagues: Leagues, now: datetime, zone: ZoneInfo
) -> tuple[list[Closed], list[Placed]]:
    """Closes every past week still open, oldest first, then cuts this week's cohorts
    from last week's players, each once: a repeat run changes nothing. A player with no
    points last week isn't placed by pace; they keep their tier and rejoin it with
    their points this week (here for points already earned, else credit_source)."""
    current = week_start(now, zone)
    closed: list[Closed] = []
    for week in leagues.due(current):
        results: list[tuple[LeagueTier, LeagueMemberResult]] = []
        for cohort in leagues.cohorts(week.id):
            results.extend((cohort.tier, r) for r in outcomes(cohort))
        if leagues.close(week.id, [r for _, r in results], now):
            closed.extend(
                Closed(r.user, tier, r.rank, r.points, r.outcome) for tier, r in results
            )
    week = leagues.week(current, zone.key)
    placed: list[Placed] = []
    if not week.formed:
        previous = leagues.week_starting(current - timedelta(days=7))
        returning = [] if previous is None else leagues.returning(previous.id)
        cohorts = cut_cohorts(returning)
        for user, tier, size in leagues.form(week.id, cohorts, now):
            placed.append(Placed(user, tier, size, mid_week=False))
        # Points earned this week before this run, by players Monday didn't place.
        for player in leagues.unplaced(week.id):
            size = leagues.place(week.id, player.user.user_id, player.tier, 0, COHORT)
            placed.append(Placed(player.user, player.tier, size, mid_week=True))
    return closed, placed


def say_leagues(sink: EventSink, closed: list[Closed], placed: list[Placed]) -> None:
    """DB-5, after the commit: each member's closed week and each placement."""
    if not closed and not placed:
        return
    events = Emitter(sink)
    for c in closed:
        events.emit(
            "league_week_closed",
            {"tier": c.tier, "rank": c.rank, "points": c.points, "outcome": c.outcome},
            EventContext(c.user.user_id, False, c.user.beta_group, None),
        )
    for p in placed:
        events.emit(
            "league_placed",
            {
                "tier": p.tier,
                "cohort_size": p.cohort_size,
                "placement": "mid_week" if p.mid_week else "monday",
            },
            EventContext(p.user.user_id, False, p.user.beta_group, None),
        )
    events.flush()
