"""Opt-in pushes (Q-P4-13, P4-W24-S01b; owner, 2026-11-11): one a day at most, at or
after the user's hour and before 21:00 in their zone; the daily challenge, then a path
reminder, then the digest; claimed before sending; gone targets dropped."""

import json
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Literal, cast

from interval_jobs.adapters.memory import InMemoryDeviceTokens, InMemoryReminders
from interval_jobs.ports import NativeTarget, PushCandidate, PushNotice, PushTarget
from interval_jobs.reminders import Unit, run_push_due, run_window_reminders

# 12:30 UTC is 18:00 in Kolkata (UTC+05:30).
NOON = datetime(2026, 11, 11, 12, 30, tzinfo=UTC)
PATH = PushNotice("path_reminder", "Next on Raft", "Elections", "/paths/3")
DIGEST = PushNotice("digest", "Your break is ready", "2 new: Raft", "/")


@dataclass
class Stub:
    reminders: InMemoryReminders = field(default_factory=InMemoryReminders)
    device_tokens: InMemoryDeviceTokens = field(default_factory=InMemoryDeviceTokens)


@dataclass
class Services:
    store: Stub


class FakeWeb:
    def __init__(self, status: int = 201) -> None:
        self.sent: list[tuple[str, dict[str, str]]] = []
        self.status = status

    def push(self, target: PushTarget, text: str) -> int:
        self.sent.append((target.endpoint, json.loads(text)))
        return self.status


class FakePhone:
    def __init__(self, outcome: Literal["sent", "gone", "failed"] = "sent") -> None:
        self.sent: list[tuple[str, str, str | None]] = []
        self.outcome: Literal["sent", "gone", "failed"] = outcome

    def send(
        self, target: NativeTarget, title: str, body: str, url: str | None = None
    ) -> Literal["sent", "gone", "failed"]:
        self.sent.append((target.token, title, url))
        return self.outcome


def person(**on: bool) -> PushCandidate:
    return PushCandidate(
        "u1",
        "Asia/Kolkata",
        18,
        on.get("daily", False),
        on.get("path", False),
        on.get("digest", False),
    )


def setup(who: PushCandidate) -> tuple[Stub, Unit]:
    store = Stub()
    store.reminders.people = [who]
    store.reminders.browsers["u1"] = [
        PushTarget("https://fcm.googleapis.com/fcm/send/a", "k", "s")
    ]
    store.device_tokens.rows["u1"] = [NativeTarget("ios", "tok")]

    @contextmanager
    def unit() -> Generator[Services]:
        yield Services(store)

    return store, cast(Unit, unit)


def test_the_daily_challenge_first_then_the_path_then_the_digest() -> None:
    store, unit = setup(person(daily=True, path=True, digest=True))
    store.reminders.daily.add("u1")
    store.reminders.paths["u1"] = PATH
    store.reminders.digests["u1"] = DIGEST
    web, phone = FakeWeb(), FakePhone()
    assert run_push_due(unit, web, phone, NOON).sent == 1
    assert web.sent == [
        (
            "https://fcm.googleapis.com/fcm/send/a",
            {
                "title": "Today's challenge is ready",
                "body": "Five questions, two minutes.",
                "url": "/play",
                "tag": "interval-daily_challenge",
            },
        )
    ]
    assert phone.sent == [("tok", "Today's challenge is ready", "/play")]
    # Once a day: the next hour sends nothing.
    assert run_push_due(unit, web, phone, NOON.replace(hour=13)).sent == 0
    assert store.reminders.sent == {("u1", date(2026, 11, 11)): "daily_challenge"}


def test_a_kind_turned_off_is_passed_over() -> None:
    store, unit = setup(person(path=False, digest=True))
    store.reminders.daily.add("u1")
    store.reminders.paths["u1"] = PATH
    store.reminders.digests["u1"] = DIGEST
    phone = FakePhone()
    run_push_due(unit, None, phone, NOON)
    assert phone.sent == [("tok", "Your break is ready", "/")]


def test_only_from_the_users_hour_and_never_in_the_quiet_hours() -> None:
    store, unit = setup(person(digest=True))
    store.reminders.digests["u1"] = DIGEST
    phone = FakePhone()
    # 17:59 and 21:00 in Kolkata.
    run_push_due(unit, None, phone, datetime(2026, 11, 11, 12, 29, tzinfo=UTC))
    run_push_due(unit, None, phone, datetime(2026, 11, 11, 15, 30, tzinfo=UTC))
    assert phone.sent == []
    # 20:59: a late hour still sends that day.
    run_push_due(unit, None, phone, datetime(2026, 11, 11, 15, 29, tzinfo=UTC))
    assert len(phone.sent) == 1


def test_nothing_that_applies_or_nowhere_to_send_claims_nothing() -> None:
    store, unit = setup(person(digest=True))
    assert run_push_due(unit, FakeWeb(), FakePhone(), NOON).skipped == 1
    store.reminders.digests["u1"] = DIGEST
    store.reminders.browsers["u1"] = []
    store.device_tokens.rows["u1"] = []
    assert run_push_due(unit, FakeWeb(), FakePhone(), NOON).skipped == 1
    assert store.reminders.sent == {}


def test_a_zone_it_cant_read_skips_that_user_only() -> None:
    store, unit = setup(person(digest=True))
    store.reminders.people.insert(
        0, PushCandidate("u0", "Mars/Olympus", 8, False, False, True)
    )
    store.reminders.digests["u1"] = DIGEST
    out = run_push_due(unit, None, FakePhone(), NOON)
    assert (out.sent, out.skipped) == (1, 1)


def test_gone_browsers_and_phones_are_dropped_and_it_counts_as_failed() -> None:
    store, unit = setup(person(digest=True))
    store.reminders.digests["u1"] = DIGEST
    out = run_push_due(unit, FakeWeb(410), FakePhone("gone"), NOON)
    assert (out.sent, out.failed) == (0, 1)
    assert store.reminders.browsers["u1"] == []
    assert store.device_tokens.rows["u1"] == []


def test_the_hour_boundary_a_dst_day_and_a_45_minute_zone() -> None:
    store, unit = setup(person(digest=True))
    store.reminders.digests["u1"] = DIGEST
    phone = FakePhone()
    # Kolkata's 18:00:00 exactly.
    run_push_due(unit, None, phone, datetime(2026, 11, 11, 12, 30, tzinfo=UTC))
    assert len(phone.sent) == 1
    # New York on the day clocks went back (2026-11-01): 18:00 EST is 23:00 UTC.
    ny = PushCandidate("u1", "America/New_York", 18, False, False, True)
    store.reminders.people = [ny]
    store.reminders.sent.clear()
    run_push_due(unit, None, phone, datetime(2026, 11, 1, 22, 0, tzinfo=UTC))
    assert len(phone.sent) == 1  # 17:00 there
    run_push_due(unit, None, phone, datetime(2026, 11, 1, 23, 0, tzinfo=UTC))
    assert len(phone.sent) == 2
    # Kathmandu (UTC+05:45): the hourly run at :00 UTC lands at :45 there.
    store.reminders.people = [
        PushCandidate("u1", "Asia/Kathmandu", 18, False, False, True)
    ]
    store.reminders.sent.clear()
    run_push_due(unit, None, phone, datetime(2026, 11, 11, 12, 0, tzinfo=UTC))
    assert len(phone.sent) == 2  # 17:45 there: before the hour, so nothing
    run_push_due(unit, None, phone, datetime(2026, 11, 11, 13, 0, tzinfo=UTC))
    assert len(phone.sent) == 3  # 18:45


def test_one_target_reached_is_sent_none_reached_stays_claimed() -> None:
    store, unit = setup(person(digest=True))
    store.reminders.digests["u1"] = DIGEST
    # The browser takes it, the phone fails: sent.
    assert run_push_due(unit, FakeWeb(201), FakePhone("failed"), NOON).sent == 1
    # Another user, both fail: failed, and the day stays claimed (at most once), so the
    # next hour doesn't try again.
    store.reminders.sent.clear()
    out = run_push_due(unit, FakeWeb(500), FakePhone("failed"), NOON)
    assert (out.sent, out.failed) == (0, 1)
    again = run_push_due(unit, FakeWeb(201), FakePhone(), NOON.replace(hour=13))
    assert (again.sent, again.failed) == (0, 0)


def test_with_no_sender_configured_nothing_is_claimed() -> None:
    store, unit = setup(person(digest=True))
    store.reminders.digests["u1"] = DIGEST
    assert run_push_due(unit, None, None, NOON).skipped == 1
    assert store.reminders.sent == {}


def test_one_users_error_never_stops_the_rest() -> None:
    store, unit = setup(person(digest=True))
    store.reminders.digests["u1"] = DIGEST
    store.reminders.people.insert(
        0, PushCandidate("boom", "UTC", 8, False, False, True)
    )
    real = store.reminders.digest

    def digest(user_id: str) -> PushNotice | None:
        if user_id == "boom":
            raise RuntimeError("bad row")
        return real(user_id)

    store.reminders.digest = digest  # type: ignore[method-assign]
    out = run_push_due(unit, None, FakePhone(), NOON)
    assert (out.sent, out.failed) == (1, 1)


# P5-W32 (Q-P5-12, Q-P5-19): a window's reminder, once, outside the daily cap.
def test_a_due_window_reminder_goes_once_to_the_registered() -> None:
    store, unit = setup(person())
    store.reminders.windows_due = ["u1"]
    store.reminders.sent[("u1", date(2026, 11, 11))] = "digest"  # the daily cap: spent
    web, phone = FakeWeb(), FakePhone()
    assert run_window_reminders(unit, web, phone, NOON).sent == 1
    assert phone.sent == [("tok", "Your battle window starts soon", "/play/battle")]
    assert run_window_reminders(unit, web, phone, NOON).sent == 0
