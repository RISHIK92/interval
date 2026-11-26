"""ADR-0045: weekly leagues. Points from finished matches, battles and passed reading
checkpoints, once per source (LOAD-5), at most 300 a day; cohorts of about 30 per tier,
cut on Monday by last week's active days; the top 7 up and the bottom 5 down, none past
Diamond or Bronze."""

from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from interval_db.messages import LeaguePoints, MatchFinished
from interval_jobs.adapters.memory import InMemoryLeagues, InMemoryStore
from interval_jobs.adapters.memory_queue import InMemoryQueue
from interval_jobs.adapters.trafilatura_extractor import TrafilaturaExtractor
from interval_jobs.events.generated import Envelope
from interval_jobs.leagues import (
    close_leagues_due,
    cohort_sizes,
    credit_source,
    cut_cohorts,
    day_bounds,
    week_start,
)
from interval_jobs.pipeline import Pipeline, StageServices, UnitOfWork
from interval_jobs.ports import (
    CheckpointFacts,
    DailyFacts,
    Delivery,
    HldFacts,
    HldSeat,
    LeagueReturning,
    LeagueUser,
    MatchFacts,
    MatchSeat,
    PenaltyFacts,
)

from .test_pipeline import _Results, web  # pyright: ignore[reportPrivateUsage]

UTC_ZONE = ZoneInfo("UTC")
# A Wednesday.
WED = datetime(2031, 3, 5, 12, tzinfo=UTC)
MONDAY = date(2031, 3, 3)


def _leagues(*users: str, zone: str = "UTC") -> InMemoryLeagues:
    """Mid-week: this week formed by Monday's run, with nobody in it yet."""
    leagues = InMemoryLeagues()
    leagues.allowed.update(users)
    leagues.form(leagues.week(MONDAY, zone).id, [], WED)
    return leagues


def _seat(user: str, *, won: bool = False, abandoned: bool = False) -> MatchSeat:
    return MatchSeat(user, abandoned, won, penalized=False)


def _quick(
    *seats: MatchSeat,
    at: datetime = WED,
    replay: bool = False,
    outcome: str = "finished",
    mode: str = "sprint",
) -> MatchFacts:
    return MatchFacts(mode, outcome, at, replay, seats)


def _points(leagues: InMemoryLeagues, user: str) -> int:
    return sum(r.points for r in leagues.rows if r.user_id == user)


def test_the_week_starts_monday_in_the_leagues_zone() -> None:
    kolkata = ZoneInfo("Asia/Kolkata")
    # Sunday 20:00 UTC is already Monday in Kolkata.
    sunday_night = datetime(2031, 3, 9, 20, tzinfo=UTC)
    assert week_start(sunday_night, UTC_ZONE) == MONDAY
    assert week_start(sunday_night, kolkata) == date(2031, 3, 10)
    start, end = day_bounds(sunday_night, kolkata)
    assert start == datetime(2031, 3, 10, tzinfo=kolkata)
    assert end - start == timedelta(days=1)


def test_a_finished_quick_match_earns_10_and_the_winner_5_more() -> None:
    leagues = _leagues("a", "b")
    leagues.matches["m1"] = _quick(_seat("a", won=True), _seat("b"))
    credit_source(leagues, "match", "m1", UTC_ZONE)
    assert (_points(leagues, "a"), _points(leagues, "b")) == (15, 10)
    assert {r.reason for r in leagues.rows} == {"match"}


def test_a_bot_or_ghost_match_earns_5_with_no_win_bonus() -> None:
    leagues = _leagues("a")
    leagues.matches["m1"] = _quick(_seat("a", won=True), replay=True)
    credit_source(leagues, "match", "m1", UTC_ZONE)
    assert _points(leagues, "a") == 5
    assert leagues.rows[0].reason == "bot_match"


def test_a_battle_earns_30_and_the_winner_15_more() -> None:
    leagues = _leagues("a", "b")
    leagues.matches["m1"] = _quick(_seat("a", won=True), _seat("b"), mode="battle")
    leagues.hld["h1"] = HldFacts(WED, (HldSeat("a", True, 2), HldSeat("b", True, 1)))
    credit_source(leagues, "match", "m1", UTC_ZONE)
    credit_source(leagues, "hld_match", "h1", UTC_ZONE)
    assert (_points(leagues, "a"), _points(leagues, "b")) == (45 + 30, 30 + 45)
    assert {r.reason for r in leagues.rows} == {"battle"}


def test_nothing_for_a_leaver_a_cancelled_match_a_practice_or_a_lone_hld_seat() -> None:
    leagues = _leagues("a", "b")
    leagues.matches["gone"] = _quick(_seat("a"), _seat("b"), outcome="cancelled")
    leagues.matches["left"] = _quick(
        _seat("a", abandoned=True), _seat("b", won=True), outcome="abandoned"
    )
    leagues.matches["practice"] = _quick(_seat("a"), mode="practice")
    leagues.hld["alone"] = HldFacts(WED, (HldSeat("a", True, 1),))
    leagues.hld["unsent"] = HldFacts(
        WED, (HldSeat("a", False, None), HldSeat("b", True, 1))
    )
    for kind, source in (
        ("match", "gone"),
        ("match", "left"),
        ("match", "practice"),
        ("hld_match", "alone"),
        ("hld_match", "unsent"),
    ):
        credit_source(leagues, kind, source, UTC_ZONE)  # type: ignore[arg-type]
    assert _points(leagues, "a") == 0
    # Owner, 2026-11-26: who stayed in an abandoned match earns its points, no bonus.
    assert _points(leagues, "b") == 10 + 45


def test_who_stayed_in_an_abandoned_match_earns_it_without_the_win_bonus() -> None:
    leagues = _leagues("a", "b", "c", "d")
    leagues.matches["q"] = _quick(
        _seat("a", abandoned=True), _seat("b", won=True), outcome="abandoned"
    )
    leagues.matches["bt"] = _quick(
        _seat("c", abandoned=True),
        _seat("d", won=True),
        outcome="abandoned",
        mode="battle",
    )
    credit_source(leagues, "match", "q", UTC_ZONE)
    credit_source(leagues, "match", "bt", UTC_ZONE)
    assert [_points(leagues, u) for u in "abcd"] == [0, 10, 0, 30]


def test_a_passed_checkpoint_earns_10_and_a_failed_one_nothing() -> None:
    leagues = _leagues("a")
    leagues.checkpoints["c1"] = CheckpointFacts(
        "a", WED, passed=True, checkpoint="section-c1"
    )
    leagues.checkpoints["c2"] = CheckpointFacts(
        "a", WED, passed=False, checkpoint="section-c2"
    )
    credit_source(leagues, "checkpoint", "c1", UTC_ZONE)
    credit_source(leagues, "checkpoint", "c2", UTC_ZONE)
    assert _points(leagues, "a") == 10


def test_only_the_first_pass_of_a_checkpoint_scores() -> None:
    leagues = _leagues("a")
    leagues.checkpoints["9"] = CheckpointFacts(
        "a", WED, passed=False, checkpoint="section-4"
    )
    leagues.checkpoints["10"] = CheckpointFacts(
        "a", WED, passed=True, checkpoint="section-4"
    )
    leagues.checkpoints["11"] = CheckpointFacts(
        "a", WED, passed=True, checkpoint="section-4"
    )
    leagues.checkpoints["12"] = CheckpointFacts(
        "a", WED, passed=True, checkpoint="chapter-4"
    )
    for attempt in ("9", "10", "11", "12"):
        credit_source(leagues, "checkpoint", attempt, UTC_ZONE)
    assert _points(leagues, "a") == 20
    assert sorted(r.source_id for r in leagues.rows) == ["chapter-4", "section-4"]


def test_the_daily_challenge_earns_5_once_per_day() -> None:
    leagues = _leagues("a")
    leagues.dailies["30"] = DailyFacts("a", date(2031, 3, 5), WED)
    leagues.dailies["31"] = DailyFacts("a", date(2031, 3, 5), WED)  # same challenge
    credit_source(leagues, "daily", "30", UTC_ZONE)
    credit_source(leagues, "daily", "31", UTC_ZONE)
    credit_source(leagues, "daily", "30", UTC_ZONE)
    assert _points(leagues, "a") == 5
    [row] = leagues.rows
    assert (row.reason, row.kind, row.source_id) == ("daily", "daily", "2031-03-05")


def test_the_daily_challenge_counts_toward_the_cap() -> None:
    leagues = _leagues("a")
    for n in range(10):  # 10 battles: 300
        leagues.matches[f"b{n}"] = _quick(_seat("a"), mode="battle")
        credit_source(leagues, "match", f"b{n}", UTC_ZONE)
    leagues.dailies["30"] = DailyFacts("a", date(2031, 3, 5), WED)
    credit_source(leagues, "daily", "30", UTC_ZONE)
    assert _points(leagues, "a") == 300


def test_a_source_scores_once() -> None:
    leagues = _leagues("a")
    leagues.matches["m1"] = _quick(_seat("a", won=True))
    credit_source(leagues, "match", "m1", UTC_ZONE)
    credit_source(leagues, "match", "m1", UTC_ZONE)
    assert _points(leagues, "a") == 15
    assert len(leagues.rows) == 1


def test_guests_and_plans_without_leagues_earn_nothing() -> None:
    leagues = _leagues("a")
    leagues.matches["m1"] = _quick(_seat("a"), _seat("guest"))
    credit_source(leagues, "match", "m1", UTC_ZONE)
    assert [r.user_id for r in leagues.rows] == ["a"]
    assert not leagues.member(1, "guest")


def test_points_stop_at_300_a_day_and_the_next_day_starts_again() -> None:
    leagues = _leagues("a")
    for n in range(12):  # 12 battle wins: 540 points before the cap
        leagues.matches[f"b{n}"] = _quick(
            _seat("a", won=True), mode="battle", at=WED + timedelta(minutes=n)
        )
        credit_source(leagues, "match", f"b{n}", UTC_ZONE)
    assert _points(leagues, "a") == 300
    # The capped matches are still recorded, at 0, as matches played.
    assert len(leagues.rows) == 12
    leagues.matches["next"] = _quick(_seat("a"), at=WED + timedelta(days=1))
    credit_source(leagues, "match", "next", UTC_ZONE)
    assert _points(leagues, "a") == 310


def test_first_points_place_a_new_player_in_bronze_mid_week() -> None:
    leagues = _leagues("a", "b")
    leagues.matches["m1"] = _quick(_seat("a", won=True), _seat("b"))
    placed = credit_source(leagues, "match", "m1", UTC_ZONE)
    assert [(p.user.user_id, p.tier, p.cohort_size, p.mid_week) for p in placed] == [
        ("a", "bronze", 1, True),
        ("b", "bronze", 2, True),
    ]
    week = leagues.week_starting(MONDAY)
    assert week is not None and leagues.member(week.id, "a")
    # Later points don't place them again.
    leagues.checkpoints["c1"] = CheckpointFacts(
        "a", WED, passed=True, checkpoint="section-c1"
    )
    assert credit_source(leagues, "checkpoint", "c1", UTC_ZONE) == []


def test_a_full_cohort_opens_another() -> None:
    users = [f"u{n:02d}" for n in range(31)]
    leagues = _leagues(*users)
    for user in users:
        leagues.checkpoints[user] = CheckpointFacts(
            user, WED, passed=True, checkpoint=f"section-{user}"
        )
        credit_source(leagues, "checkpoint", user, UTC_ZONE)
    sizes = sorted(len(c.members) for c in leagues.cohorts(1))
    assert sizes == [1, 30]


def test_a_returning_player_rejoins_their_own_tier() -> None:
    leagues = _leagues("a")
    leagues.tiers["a"] = "ruby"
    leagues.checkpoints["c1"] = CheckpointFacts(
        "a", WED, passed=True, checkpoint="section-c1"
    )
    [placed] = credit_source(leagues, "checkpoint", "c1", UTC_ZONE)
    assert placed.tier == "ruby"


def test_a_penalty_takes_a_human_matchs_points_back_once() -> None:
    leagues = _leagues("a")
    leagues.matches["m1"] = _quick(_seat("a", won=True))
    credit_source(leagues, "match", "m1", UTC_ZONE)
    leagues.penalties["7"] = PenaltyFacts("a", "m1", WED + timedelta(days=9))
    credit_source(leagues, "fair_play", "7", UTC_ZONE)
    credit_source(leagues, "fair_play", "7", UTC_ZONE)
    assert _points(leagues, "a") == 0
    penalty = leagues.rows[-1]
    assert (penalty.points, penalty.reason, penalty.kind) == (
        -15,
        "penalty",
        "fair_play",
    )
    # In the week the points were earned, even when decided later.
    assert penalty.week_id == leagues.rows[0].week_id


def test_a_penalty_before_the_result_leaves_that_seat_unscored() -> None:
    leagues = _leagues("a", "b")
    leagues.matches["m1"] = _quick(
        MatchSeat("a", False, True, penalized=True), _seat("b")
    )
    credit_source(leagues, "match", "m1", UTC_ZONE)
    assert [r.user_id for r in leagues.rows] == ["b"]


def test_late_points_correct_a_closed_week_but_place_nobody() -> None:
    leagues = _leagues("a")
    week = leagues.week(MONDAY, "UTC")
    leagues.close(week.id, [], WED)
    leagues.matches["m1"] = _quick(_seat("a"))
    assert credit_source(leagues, "match", "m1", UTC_ZONE) == []
    assert _points(leagues, "a") == 10
    assert not leagues.member(week.id, "a")


@pytest.mark.parametrize(
    ("players", "sizes"),
    [
        (0, []),
        (1, [1]),
        (39, [39]),
        (40, [20, 20]),
        (59, [30, 29]),
        (60, [30, 30]),
        (61, [21, 20, 20]),
        (90, [30, 30, 30]),
    ],
)
def test_a_tiers_monday_cohorts(players: int, sizes: list[int]) -> None:
    assert cohort_sizes(players) == sizes


def test_cohorts_are_cut_by_pace_within_each_tier() -> None:
    returning = [
        LeagueReturning(LeagueUser(f"u{n:02d}", None), "gold", n % 8) for n in range(45)
    ] + [LeagueReturning(LeagueUser("r", None), "ruby", 1)]
    cohorts = cut_cohorts(returning)
    assert [(tier, len(players)) for tier, players in cohorts] == [
        ("gold", 23),
        ("gold", 22),
        ("ruby", 1),
    ]
    first, second = cohorts[0][1], cohorts[1][1]
    assert min(p.pace_days for p in first) >= max(p.pace_days for p in second)


def _member_points(
    leagues: InMemoryLeagues, week: int, user: str, points: int, at: datetime
) -> None:
    leagues.add(
        user, week, "checkpoint", f"{user}-{at.isoformat()}", points, "checkpoint", at
    )


def _cohort_of(
    leagues: InMemoryLeagues, week_id: int, tier: str, users: list[str]
) -> None:
    for user in users:
        leagues.allowed.add(user)
        leagues.tiers[user] = tier  # type: ignore[assignment]
        leagues.place(week_id, user, tier, 0, 30)  # type: ignore[arg-type]


def test_closing_moves_the_top_7_up_and_the_bottom_5_down() -> None:
    leagues = InMemoryLeagues()
    week = leagues.week(MONDAY, "UTC")
    users = [f"u{n:02d}" for n in range(30)]
    _cohort_of(leagues, week.id, "sapphire", users)
    for n, user in enumerate(users):
        _member_points(leagues, week.id, user, 300 - n, WED)
    closed, _ = close_leagues_due(leagues, WED + timedelta(days=7), UTC_ZONE)
    outcomes = {c.user.user_id: (c.rank, c.outcome) for c in closed}
    assert [outcomes[u][1] for u in users] == ["up"] * 7 + ["stay"] * 18 + ["down"] * 5
    assert leagues.tiers["u00"] == "ruby"
    assert leagues.tiers["u10"] == "sapphire"
    assert leagues.tiers["u29"] == "gold"
    # Once: a second run closes nothing.
    again, _ = close_leagues_due(leagues, WED + timedelta(days=7), UTC_ZONE)
    assert again == []


def test_equal_points_rank_by_who_reached_them_first() -> None:
    leagues = InMemoryLeagues()
    week = leagues.week(MONDAY, "UTC")
    _cohort_of(leagues, week.id, "gold", ["late", "early"])
    _member_points(leagues, week.id, "late", 50, WED + timedelta(hours=2))
    _member_points(leagues, week.id, "early", 50, WED)
    [cohort] = leagues.cohorts(week.id)
    assert [m.user.user_id for m in cohort.members] == ["early", "late"]


def test_nobody_leaves_bronze_downward_or_diamond_upward() -> None:
    leagues = InMemoryLeagues()
    week = leagues.week(MONDAY, "UTC")
    bronze = [f"b{n}" for n in range(10)]
    diamond = [f"d{n}" for n in range(10)]
    _cohort_of(leagues, week.id, "bronze", bronze)
    _cohort_of(leagues, week.id, "diamond", diamond)
    for n, user in enumerate(bronze + diamond):
        _member_points(leagues, week.id, user, 100 - n % 10, WED)
    closed, _ = close_leagues_due(leagues, WED + timedelta(days=7), UTC_ZONE)
    by_tier = {
        tier: [c.outcome for c in closed if c.tier == tier]
        for tier in ("bronze", "diamond")
    }
    # 10 members: round(10 * 7 / 30) = 2 up, round(10 * 5 / 30) = 2 down.
    assert by_tier["bronze"] == ["up"] * 2 + ["stay"] * 8
    assert by_tier["diamond"] == ["stay"] * 8 + ["down"] * 2
    assert leagues.tiers["b0"] == "silver" and leagues.tiers["d9"] == "ruby"


def test_an_inactive_member_ranks_last_and_can_move_down() -> None:
    leagues = InMemoryLeagues()
    week = leagues.week(MONDAY, "UTC")
    users = [f"u{n}" for n in range(6)]
    _cohort_of(leagues, week.id, "gold", users)
    for user in users[1:]:
        _member_points(leagues, week.id, user, 40, WED)
    closed, _ = close_leagues_due(leagues, WED + timedelta(days=7), UTC_ZONE)
    last = next(c for c in closed if c.user.user_id == "u0")
    assert (last.rank, last.points, last.outcome) == (6, 0, "down")


def test_monday_places_last_weeks_players_at_their_new_tier_and_skips_the_idle() -> (
    None
):
    leagues = InMemoryLeagues()
    week = leagues.week(MONDAY, "UTC")
    _cohort_of(leagues, week.id, "silver", ["top", "idle", "mid", "x", "y"])
    _member_points(leagues, week.id, "top", 90, WED)
    _member_points(leagues, week.id, "top", 10, WED + timedelta(days=1))
    for user in ("mid", "x", "y"):
        _member_points(leagues, week.id, user, 20, WED)
    closed, placed = close_leagues_due(leagues, WED + timedelta(days=7), UTC_ZONE)
    assert {c.user.user_id for c in closed} == {"top", "idle", "mid", "x", "y"}
    by_user = {p.user.user_id: p for p in placed}
    assert set(by_user) == {"top", "mid", "x", "y"}  # idle had no points
    assert by_user["top"].tier == "gold" and not by_user["top"].mid_week
    assert leagues.tiers["idle"] == "bronze"  # moved down, kept, not placed
    new_week = leagues.week_starting(MONDAY + timedelta(days=7))
    assert new_week is not None and new_week.formed
    pace = {m.user_id: m.pace_days for m in leagues.members if m.week_id == new_week.id}
    assert pace["top"] == 2 and pace["mid"] == 1
    # Once.
    assert close_leagues_due(leagues, WED + timedelta(days=7), UTC_ZONE) == ([], [])


def test_points_before_mondays_run_wait_for_it_and_its_tier_moves() -> None:
    leagues = InMemoryLeagues()
    last = leagues.week(MONDAY, "UTC")
    users = ["a", "b", "c", "d"]
    _cohort_of(leagues, last.id, "gold", users)
    for n, user in enumerate(users):
        _member_points(leagues, last.id, user, 40 - n, WED)
    leagues.allowed.add("new")
    # Points at 00:10 on Monday, last week still open and this one not formed.
    monday = datetime(2031, 3, 10, 0, 10, tzinfo=UTC)
    leagues.checkpoints["c1"] = CheckpointFacts(
        "a", monday, passed=True, checkpoint="section-c1"
    )
    leagues.checkpoints["c2"] = CheckpointFacts(
        "new", monday, passed=True, checkpoint="section-c2"
    )
    assert credit_source(leagues, "checkpoint", "c1", UTC_ZONE) == []
    assert credit_source(leagues, "checkpoint", "c2", UTC_ZONE) == []
    _, placed = close_leagues_due(leagues, monday + timedelta(hours=1), UTC_ZONE)
    by_user = {p.user.user_id: p for p in placed}
    # a was promoted and is placed in Sapphire by pace; new joins Bronze.
    assert (by_user["a"].tier, by_user["a"].mid_week) == ("sapphire", False)
    assert (by_user["new"].tier, by_user["new"].mid_week) == ("bronze", True)
    week = leagues.week_starting(date(2031, 3, 10))
    assert week is not None
    assert sum(m.user_id == "a" for m in leagues.members if m.week_id == week.id) == 1


def test_a_capped_match_doesnt_move_when_a_total_was_reached() -> None:
    leagues = InMemoryLeagues()
    week = leagues.week(MONDAY, "UTC")
    _cohort_of(leagues, week.id, "gold", ["capped", "other"])
    _member_points(leagues, week.id, "capped", 50, WED)
    _member_points(leagues, week.id, "other", 50, WED + timedelta(hours=1))
    _member_points(leagues, week.id, "capped", 0, WED + timedelta(hours=2))
    [cohort] = leagues.cohorts(week.id)
    assert [m.user.user_id for m in cohort.members] == ["capped", "other"]


def test_pace_counts_days_in_the_weeks_zone() -> None:
    leagues = InMemoryLeagues()
    leagues.allowed.add("a")
    week = leagues.week(MONDAY, "Asia/Kolkata")
    # 12:00 and 20:00 UTC on Wednesday: Wednesday and Thursday in Kolkata.
    _member_points(leagues, week.id, "a", 10, WED)
    _member_points(leagues, week.id, "a", 10, WED + timedelta(hours=8))
    [back] = leagues.returning(week.id)
    assert back.pace_days == 2


class _Sink:
    def __init__(self) -> None:
        self.events: list[Envelope] = []

    def write(self, batch: list[Envelope]) -> list[Envelope]:
        self.events.extend(batch)
        return []


def _unit(store: InMemoryStore) -> UnitOfWork:
    @contextmanager
    def unit() -> Generator[StageServices]:
        yield StageServices(store, web(), TrafilaturaExtractor())

    return unit


def test_a_recorded_match_queues_its_league_points() -> None:
    golden = (
        Path(__file__).parents[3] / "services" / "game" / "testdata"
    ) / "match_finished.json"
    match_id = "6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b"
    queue = InMemoryQueue()
    results = _Results({f"game:result:{match_id}": golden.read_bytes()})
    pipeline = Pipeline(_unit(InMemoryStore()), queue, results=results)
    handler = pipeline.handlers()["match_finished"]
    handler(MatchFinished(match_id=match_id), Delivery(1, f"match-{match_id}"))
    assert queue.pending_messages("league_points") == [
        (
            f"league-match-{match_id}",
            {"source_kind": "match", "source_id": match_id},
        )
    ]


def test_the_stage_scores_a_source_and_says_each_placement_once() -> None:
    store = InMemoryStore()
    store.leagues.form(store.leagues.week(MONDAY, "Asia/Kolkata").id, [], WED)
    store.leagues.allowed.add("a")
    store.leagues.groups["a"] = "developer"
    store.leagues.matches["m1"] = _quick(_seat("a", won=True))
    sink = _Sink()
    zone = ZoneInfo("Asia/Kolkata")
    pipeline = Pipeline(_unit(store), InMemoryQueue(), events=sink, league_zone=zone)
    handler = pipeline.handlers()["league_points"]
    message = LeaguePoints(source_kind="match", source_id="m1")
    handler(message, Delivery(1, "league-match-m1"))
    handler(message, Delivery(2, "league-match-m1"))
    assert _points(store.leagues, "a") == 15
    [event] = sink.events
    assert event.name == "league_placed" and event.beta_group == "developer"
    assert event.props.model_dump() == {
        "tier": "bronze",
        "cohort_size": 1,
        "placement": "mid_week",
    }
    # In the zone's week.
    [week] = store.leagues.weeks.values()
    assert store.leagues.member(week.id, "a")
