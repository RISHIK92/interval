"""Quick-game seasons (P3-W16-S06, Q-P3-13; owner, 2026-11-03): one per calendar month
(UTC). On the 1st the month just ended closes: its final board is kept and every rating
is soft-reset (ratings.season_reset), once."""

from datetime import UTC, datetime

from interval_jobs.ports import Seasons


def season_before(now: datetime) -> tuple[str, datetime, datetime]:
    """The month before `now`'s (UTC): its name (YYYY-MM), start and end."""
    end = datetime(now.year, now.month, 1, tzinfo=UTC)
    start = datetime(
        end.year - (1 if end.month == 1 else 0),
        12 if end.month == 1 else end.month - 1,
        1,
        tzinfo=UTC,
    )
    return f"{start.year:04d}-{start.month:02d}", start, end


def close_season(seasons: Seasons, now: datetime) -> dict[str, str | bool]:
    """Closes the month just ended, once; run daily, so a failed close is tried again
    the next day. Only that month: one the job missed for a whole month keeps no
    board and isn't reset again."""
    season, start, end = season_before(now)
    return {"season": season, "closed": seasons.close(season, start, end)}
