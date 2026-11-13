"""Opt-in pushes (Q-P4-13, P4-W24-S01b; owner, 2026-11-11): at most one a day, at or
after the user's hour in their own zone and before the quiet hours (21:00), the first
that applies of the daily challenge, a path reminder and the digest. Run hourly
(`push-due`). The day is claimed before sending (LOAD-5); the network is never inside a
transaction."""

import json
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Protocol
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from interval_jobs import log
from interval_jobs.agent_push import deliver as deliver_web
from interval_jobs.native_push import deliver as deliver_native
from interval_jobs.ports import (
    DeviceTokens,
    NativePush,
    NativeTarget,
    PushCandidate,
    PushNotice,
    PushTarget,
    Reminders,
    WebPush,
)

QUIET_FROM = 21  # Q-P4-13: nothing from 21:00 to 08:00 local

DAILY = PushNotice(
    "daily_challenge",
    "Today's challenge is ready",
    "Five questions, two minutes.",
    "/play",
)


class HasReminders(Protocol):
    @property
    def reminders(self) -> Reminders: ...

    @property
    def device_tokens(self) -> DeviceTokens: ...


class HasStore(Protocol):
    @property
    def store(self) -> HasReminders: ...


Unit = Callable[[], AbstractContextManager[HasStore]]


@dataclass
class PushRun:
    sent: int = 0  # users pushed to
    skipped: int = 0  # due, but nothing applied or nowhere to send
    failed: int = 0  # every target failed


def local_day(person: PushCandidate, now: datetime) -> date | None:
    """The user's day when now is within their window, else None."""
    local = now.astimezone(ZoneInfo(person.time_zone))
    return local.date() if person.hour <= local.hour < QUIET_FROM else None


def choose(store: Reminders, person: PushCandidate, now: datetime) -> PushNotice | None:
    if person.daily_challenge and store.daily_open(
        person.user_id, now.astimezone(UTC).date()
    ):
        return DAILY
    if person.path_reminder:
        due = store.path_due(person.user_id, now)
        if due is not None:
            return due
    return store.digest(person.user_id) if person.digest else None


def web_text(notice: PushNotice) -> str:
    # What apps/web/public/sw.js shows; the tag keeps one of each kind on screen.
    return json.dumps(
        {
            "title": notice.title,
            "body": notice.body,
            "url": notice.url,
            "tag": f"interval-{notice.kind}",
        }
    )


def run_push_due(
    unit: Unit, web: WebPush | None, native: NativePush | None, now: datetime
) -> PushRun:
    out = PushRun()
    with unit() as s:
        people = s.store.reminders.candidates()
    for person in people:
        try:
            _push_one(unit, web, native, now, person, out)
        except Exception as error:  # one user's data: never everyone after them
            out.failed += 1
            log.error(
                "push: not delivered",
                user_id=person.user_id,
                error=type(error).__name__,
            )
    return out


def _push_one(
    unit: Unit,
    web: WebPush | None,
    native: NativePush | None,
    now: datetime,
    person: PushCandidate,
    out: PushRun,
) -> None:
    try:
        day = local_day(person, now)
    except (ZoneInfoNotFoundError, ValueError):
        # The web app stores only zones it checked; one it can't read here is a bug to
        # see, not a reason to stop everyone else's.
        log.error("push: zone unknown", user_id=person.user_id)
        out.skipped += 1
        return
    if day is None:
        return
    with unit() as s:
        store = s.store.reminders
        if store.sent_on(person.user_id, day):
            return
        notice = choose(store, person, now)
        browsers: list[PushTarget] = (
            store.web_targets(person.user_id) if web is not None else []
        )
        phones: list[NativeTarget] = (
            s.store.device_tokens.for_user(person.user_id) if native is not None else []
        )
        # Nowhere to send: not claimed, so a device added later today still gets it.
        if notice is None or not (browsers or phones):
            out.skipped += 1
            return
        # At most once (Q-P4-13): claimed before sending, so a failure isn't retried
        # that day either.
        if not store.claim(person.user_id, day, notice.kind):
            return
    _send(unit, web, native, person.user_id, notice, browsers, phones, out)


# P5-W32 (Q-P5-12, Q-P5-19): a registered ranked window's reminder, 15 minutes before.
WINDOW = PushNotice(
    "battle_window",
    # Not "in 15 minutes": a late registration's reminder goes on the next run.
    "Your battle window starts soon",
    "Rooms are matched at the start: be there.",
    "/play/battle",
)


def run_window_reminders(
    unit: Unit, web: WebPush | None, native: NativePush | None, now: datetime
) -> PushRun:
    """Each due registration's reminder, claimed before sending (LOAD-5): a failure
    isn't retried, as the daily pushes aren't. Apart from the one-a-day cap: the player
    asked for it by registering."""
    out = PushRun()
    with unit() as s:
        users = s.store.reminders.claim_windows(now)
    for user_id in users:
        try:
            with unit() as s:
                browsers: list[PushTarget] = (
                    s.store.reminders.web_targets(user_id) if web is not None else []
                )
                phones: list[NativeTarget] = (
                    s.store.device_tokens.for_user(user_id)
                    if native is not None
                    else []
                )
            if not (browsers or phones):
                out.skipped += 1
                continue
            _send(unit, web, native, user_id, WINDOW, browsers, phones, out)
        except Exception as error:  # one user's data: never everyone after them
            out.failed += 1
            log.error(
                "push: not delivered", user_id=user_id, error=type(error).__name__
            )
    return out


def _send(
    unit: Unit,
    web: WebPush | None,
    native: NativePush | None,
    user_id: str,
    notice: PushNotice,
    browsers: list[PushTarget],
    phones: list[NativeTarget],
    out: PushRun,
) -> None:
    sent = 0
    gone_web: list[str] = []
    gone_phones: list[str] = []
    if web is not None and browsers:
        # "reminder:", not "agent:": the agent hook's metric counts only its failures.
        got = deliver_web(web, browsers, web_text(notice), what="reminder")
        sent, gone_web = sent + got.sent, got.gone
    if native is not None and phones:
        got = deliver_native(native, phones, notice.title, notice.body, notice.url)
        sent, gone_phones = sent + got.sent, got.gone
    if gone_web or gone_phones:
        with unit() as s:
            for endpoint in gone_web:
                s.store.reminders.drop_web(endpoint)
            for token in gone_phones:
                s.store.device_tokens.drop(token)
    if sent > 0:
        out.sent += 1
        log.info("push: sent", user_id=user_id, kind=notice.kind, to=sent)
    else:
        out.failed += 1
        log.error("push: not delivered", user_id=user_id, kind=notice.kind)
