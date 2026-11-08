"""P3-W17-S05b (§7, Q-P3-18; owner, 2026-11-03): 45 seconds into an agent's task, each
browser its player subscribed gets a push, only while the task runs; a gone
subscription is dropped; nothing about the task is in it."""

import json
from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

import httpx
import psycopg
import pytest

from interval_db.messages import AgentNudge
from interval_jobs.adapters.http_webpush import HttpWebPush
from interval_jobs.adapters.memory import FakeFetcher, InMemoryStore
from interval_jobs.adapters.memory_queue import InMemoryQueue
from interval_jobs.adapters.postgres import PostgresAgentNudges
from interval_jobs.adapters.trafilatura_extractor import TrafilaturaExtractor
from interval_jobs.agent_push import NOTICE, deliver, push_service
from interval_jobs.compose import web_push
from interval_jobs.pipeline import Pipeline, StageServices
from interval_jobs.ports import Delivery, PushTarget
from interval_jobs.webpush import private_key

from .test_db_guards import a_user

NOW = datetime(2031, 1, 1, 12, tzinfo=UTC)
P256DH = (
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNto"
    "IAiw4"
)
AUTH = "BTBZMqHH6r4Tts7J_aSIgg"


FCM = "https://fcm.googleapis.com/fcm/send/"


class FakePush:
    def __init__(
        self,
        statuses: dict[str, int] | None = None,
        raises: dict[str, Exception] | None = None,
    ) -> None:
        self.sent: list[tuple[str, str]] = []
        self._statuses = statuses or {}
        self._raises = raises or {}

    def push(self, target: PushTarget, text: str) -> int:
        self.sent.append((target.endpoint, text))
        if target.endpoint in self._raises:
            raise self._raises[target.endpoint]
        return self._statuses.get(target.endpoint, 201)


def test_each_browser_is_pushed_one_failing_stops_none_and_gone_ones_are_listed() -> (
    None
):
    targets = [
        PushTarget(FCM + "a", P256DH, AUTH),
        PushTarget(FCM + "b", P256DH, AUTH),
        PushTarget(FCM + "c", P256DH, AUTH),
        PushTarget(FCM + "d", P256DH, AUTH),
        PushTarget(FCM + "e", P256DH, AUTH),
        PushTarget("https://intranet.example/hook", P256DH, AUTH),
    ]
    push = FakePush(
        statuses={FCM + "b": 410, FCM + "c": 404, FCM + "d": 500},
        raises={FCM + "e": httpx.ConnectError("down")},
    )
    out = deliver(push, targets, NOTICE)
    assert (out.sent, out.failed, out.gone) == (1, 3, [FCM + "b", FCM + "c"])
    # Never posted: a host that isn't a browser's push service.
    assert "https://intranet.example/hook" not in [e for e, _ in push.sent]
    # The text is fixed: nothing about the task.
    assert {text for _, text in push.sent} == {NOTICE}
    assert json.loads(NOTICE)["url"] == "/"


@pytest.mark.parametrize(
    ("endpoint", "ok"),
    [
        ("https://fcm.googleapis.com/fcm/send/x", True),
        ("https://updates.push.services.mozilla.com/wpush/v2/x", True),
        ("https://web.push.apple.com/x", True),
        ("https://wns2-db5p.notify.windows.com/w/?token=x", True),
        ("http://fcm.googleapis.com/fcm/send/x", False),
        ("https://fcm.googleapis.com:8443/x", False),
        ("https://169.254.169.254/latest", False),
        ("https://push.apple.com.evil.example/x", False),
        ("https://evilpush.apple.com/x", False),
    ],
)
def test_only_the_browsers_push_services_are_posted_to(endpoint: str, ok: bool) -> None:
    assert push_service(endpoint) is ok


def test_an_off_curve_key_fails_that_browser_only() -> None:
    # Shaped right, but not a point on P-256: encrypt raises; counted, not thrown.
    bad = "B" + "A" * 86
    adapter = HttpWebPush(
        httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(201))),
        private_key("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
        "mailto:owner@example.test",
    )
    out = deliver(
        adapter,
        [PushTarget(FCM + "bad", bad, AUTH), PushTarget(FCM + "ok", P256DH, AUTH)],
        NOTICE,
    )
    assert (out.sent, out.failed) == (1, 1)


def _task(
    conn: psycopg.Connection,
    user: str,
    started: datetime,
    finished: datetime | None = None,
    revoked: bool = False,
) -> int:
    device = conn.execute(
        "insert into agent_device (user_id, name, token_hash, revoked_at)"
        " values (%s, 'Laptop', md5(random()::text) || md5(random()::text), %s)"
        " returning id",
        (user, NOW if revoked else None),
    ).fetchone()
    assert device is not None
    row = conn.execute(
        "insert into agent_task (device_id, user_id, started_at, finished_at,"
        " start_key) values (%s, %s, %s, %s, md5(random()::text)) returning id",
        (device[0], user, started, finished),
    ).fetchone()
    assert row is not None
    return int(row[0])


def test_postgres_targets_only_while_the_task_runs(conn: psycopg.Connection) -> None:
    a_user(conn, "pna")
    conn.execute(
        "insert into push_subscription (user_id, endpoint, p256dh, auth)"
        " values ('pna', 'https://fcm.googleapis.com/fcm/send/x', %s, %s)",
        (P256DH, AUTH),
    )
    nudges = PostgresAgentNudges(conn)
    running = _task(conn, "pna", NOW - timedelta(seconds=45))
    assert nudges.targets(running, NOW) == [PushTarget(FCM + "x", P256DH, AUTH)]
    done = _task(conn, "pna", NOW - timedelta(minutes=1), finished=NOW)
    assert nudges.targets(done, NOW) is None
    stale = _task(conn, "pna", NOW - timedelta(hours=3))
    assert nudges.targets(stale, NOW) is None
    revoked = _task(conn, "pna", NOW - timedelta(seconds=45), revoked=True)
    assert nudges.targets(revoked, NOW) is None
    # ADR-0036: a plan without push.notify gets no push, its subscriptions kept.
    conn.execute(
        "delete from plan_capability "
        "where plan_id = 'beta' and capability = 'push.notify'"
    )
    assert nudges.targets(running, NOW) == []
    conn.execute(
        "insert into plan_capability (plan_id, capability) "
        "values ('beta', 'push.notify')"
    )
    nudges.drop(FCM + "x")
    assert nudges.targets(running, NOW) == []


def test_the_stage_pushes_while_running_drops_the_gone_and_skips_when_off() -> None:
    store = InMemoryStore()
    store.agent_nudges.running[3] = [
        PushTarget(FCM + "a", P256DH, AUTH),
        PushTarget(FCM + "gone", P256DH, AUTH),
    ]

    @contextmanager
    def unit() -> Generator[StageServices]:
        yield StageServices(store, FakeFetcher({}), TrafilaturaExtractor())

    delivery = Delivery(attempt=1, idempotency_key="nudge-3")
    Pipeline(unit, InMemoryQueue()).handlers()["agent_nudge"](
        AgentNudge(task_id=3), delivery
    )
    push = FakePush(statuses={FCM + "gone": 410})
    Pipeline(unit, InMemoryQueue(), push=push).handlers()["agent_nudge"](
        AgentNudge(task_id=3), delivery
    )
    assert [endpoint for endpoint, _ in push.sent] == [FCM + "a", FCM + "gone"]
    assert store.agent_nudges.dropped == [FCM + "gone"]
    # A task no longer running: nothing.
    Pipeline(unit, InMemoryQueue(), push=push).handlers()["agent_nudge"](
        AgentNudge(task_id=99), delivery
    )
    assert len(push.sent) == 2


def test_the_http_adapter_sends_an_encrypted_signed_short_lived_push() -> None:
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(201)

    key = private_key("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw")
    adapter = HttpWebPush(
        httpx.Client(transport=httpx.MockTransport(handle)),
        key,
        "mailto:owner@example.test",
    )
    target = PushTarget(FCM + "sub1", P256DH, AUTH)
    assert adapter.push(target, NOTICE) == 201
    request = seen[0]
    assert str(request.url) == FCM + "sub1"
    assert request.headers["content-encoding"] == "aes128gcm"
    assert request.headers["ttl"] == "60"
    assert request.headers["authorization"].startswith("vapid t=")
    # Encrypted: the notice's text isn't in the body.
    assert b"agent" not in request.content
    assert len(request.content) > 86 + len(NOTICE)


@pytest.mark.parametrize(
    ("key", "subject"),
    [
        ("", "mailto:a@b.test"),
        ("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", ""),
        ("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", "http://localhost"),
        ("a" * 48, "https://interval.example"),  # a deployment's placeholder
    ],
)
def test_web_push_is_off_without_its_key_and_subject(
    monkeypatch: pytest.MonkeyPatch, key: str, subject: str
) -> None:
    monkeypatch.setenv("VAPID_PRIVATE_KEY", key)
    monkeypatch.setenv("VAPID_SUBJECT", subject)
    assert web_push() is None


def test_web_push_is_on_with_a_real_key_and_subject(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        "VAPID_PRIVATE_KEY", "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"
    )
    monkeypatch.setenv("VAPID_SUBJECT", "https://interval.example")
    assert web_push() is not None
