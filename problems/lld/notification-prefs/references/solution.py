from __future__ import annotations

CHANNELS = ("email", "push", "sms")  # sorted


def _check(user: str, channel: str | None = None) -> None:
    if user == "":
        raise ValueError("a user is not empty")
    if channel is not None and channel not in CHANNELS:
        raise ValueError("unknown channel")


def _hour(hour: int) -> None:
    if not 0 <= hour <= 23:
        raise ValueError("an hour is from 0 to 23")


class QuietHours:
    """When a user doesn't want to be disturbed; knows nothing about channels. The same
    start and end is an empty window."""

    def __init__(self, start: int, end: int) -> None:
        self._start = start
        self._end = end

    def contains(self, hour: int) -> bool:
        if self._start <= self._end:
            return self._start <= hour < self._end
        return hour >= self._start or hour < self._end  # wraps past midnight


class Preferences:
    """What one user chose. It answers questions about itself and never routes."""

    def __init__(self) -> None:
        self._opted_out: set[str] = set()
        self._quiet: QuietHours | None = None
        self._digested: set[str] = set()
        self._held: dict[str, int] = {}  # channel -> messages held for the digest

    def opt_out(self, channel: str) -> None:
        self._opted_out.add(channel)
        self._held.pop(channel, None)

    def set_quiet(self, quiet: QuietHours) -> None:
        self._quiet = quiet

    def receives(self, channel: str) -> bool:
        return channel not in self._opted_out

    def is_quiet(self, hour: int) -> bool:
        return self._quiet is not None and self._quiet.contains(hour)

    def use_digest(self, channel: str) -> None:
        self._digested.add(channel)

    def holds(self, channel: str) -> bool:
        """Holds a message for the digest when the channel uses one."""
        held = channel in self._digested
        if held:
            self._held[channel] = self._held.get(channel, 0) + 1
        return held

    def flush(self) -> int:
        held = sum(self._held.values())
        self._held.clear()
        return held


class NotificationPrefs:
    """Keeps preferences and decides delivery; sending is someone else's job."""

    def __init__(self) -> None:
        self._users: dict[str, Preferences] = {}

    def _prefs(self, user: str) -> Preferences:
        return self._users.setdefault(user, Preferences())

    def optOut(self, user: str, channel: str) -> None:
        _check(user, channel)
        self._prefs(user).opt_out(channel)

    def quietHours(self, user: str, startHour: int, endHour: int) -> None:
        _check(user)
        _hour(startHour)
        _hour(endHour)
        self._prefs(user).set_quiet(QuietHours(startHour, endHour))

    def route(self, user: str, channel: str, hour: int, urgent: bool) -> bool:
        _check(user, channel)
        _hour(hour)
        prefs = self._users.get(user)
        if prefs is None:
            return True
        if not prefs.receives(channel):
            return False
        if urgent:
            return True
        return not prefs.holds(channel) and not prefs.is_quiet(hour)

    def channels(self, user: str) -> list[str]:
        _check(user)
        prefs = self._users.get(user)
        return [c for c in CHANNELS if prefs is None or prefs.receives(c)]

    # The extension round: non-urgent messages on a digest channel wait for the digest.
    def digest(self, user: str, channel: str) -> None:
        _check(user, channel)
        self._prefs(user).use_digest(channel)

    def flushDigest(self, user: str) -> int:
        _check(user)
        prefs = self._users.get(user)
        return 0 if prefs is None else prefs.flush()
