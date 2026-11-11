"""Native push (P4-W19-S04b, Q-P4-03): the worker sends straight to APNs and FCM.
Tested against fakes: real delivery needs the owner's Apple and Firebase accounts."""

import base64
import json
from datetime import UTC, datetime
from typing import Literal

import httpx
import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

from interval_jobs import compose
from interval_jobs.adapters.http_native_push import (
    ApnsConfig,
    FcmConfig,
    HttpNativePush,
)
from interval_jobs.adapters.memory import InMemoryDeviceTokens
from interval_jobs.native_push import apns_jwt, deliver, fcm_assertion, push_test
from interval_jobs.ports import NativeTarget

NOW = datetime(2026, 11, 9, 12, 0, tzinfo=UTC)
EC_KEY = ec.generate_private_key(ec.SECP256R1())
RSA_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _parts(token: str) -> tuple[dict[str, object], dict[str, object], bytes, bytes]:
    head, claims, signature = token.split(".")

    def unb64(text: str) -> bytes:
        return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))

    return (
        json.loads(unb64(head)),
        json.loads(unb64(claims)),
        f"{head}.{claims}".encode(),
        unb64(signature),
    )


def test_the_apns_token_is_an_es256_jwt_apple_can_check() -> None:
    header, claims, signed, signature = _parts(
        apns_jwt("TEAM123", "KEY456", EC_KEY, NOW)
    )
    assert header == {"alg": "ES256", "kid": "KEY456"}
    assert claims == {"iss": "TEAM123", "iat": int(NOW.timestamp())}
    der = encode_dss_signature(
        int.from_bytes(signature[:32], "big"), int.from_bytes(signature[32:], "big")
    )
    EC_KEY.public_key().verify(der, signed, ec.ECDSA(hashes.SHA256()))


def test_the_fcm_assertion_is_an_rs256_jwt_for_googles_token_endpoint() -> None:
    header, claims, signed, signature = _parts(
        fcm_assertion("push@proj.iam.gserviceaccount.com", RSA_KEY, NOW)
    )
    assert header == {"alg": "RS256", "typ": "JWT"}
    epoch = int(NOW.timestamp())
    assert claims == {
        "iss": "push@proj.iam.gserviceaccount.com",
        "scope": "https://www.googleapis.com/auth/firebase.messaging",
        "aud": "https://oauth2.googleapis.com/token",
        "iat": epoch,
        "exp": epoch + 3600,
    }
    RSA_KEY.public_key().verify(signature, signed, padding.PKCS1v15(), hashes.SHA256())


class _Recorder:
    def __init__(self, replies: dict[str, httpx.Response]) -> None:
        self.replies = replies
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        for prefix, reply in self.replies.items():
            if str(request.url).startswith(prefix):
                return reply
        raise AssertionError(f"unexpected host: {request.url}")


def _sender(
    replies: dict[str, httpx.Response],
) -> tuple[HttpNativePush, _Recorder]:
    recorder = _Recorder(replies)
    client = httpx.Client(transport=httpx.MockTransport(recorder))
    return (
        HttpNativePush(
            client,
            ApnsConfig("TEAM123", "KEY456", EC_KEY, sandbox=False),
            FcmConfig("proj", "push@proj.iam.gserviceaccount.com", RSA_KEY),
            clock=lambda: NOW,
        ),
        recorder,
    )


APNS = "https://api.push.apple.com/3/device/"
TOKEN_URL = "https://oauth2.googleapis.com/token"
FCM = "https://fcm.googleapis.com/v1/projects/proj/messages:send"
FCM_ERROR = "type.googleapis.com/google.firebase.fcm.v1.FcmError"


def test_an_ios_push_goes_to_apns_as_an_alert_for_the_app() -> None:
    sender, seen = _sender({APNS: httpx.Response(200)})
    assert sender.send(NativeTarget("ios", "ab12"), "Hi", "There") == "sent"
    (request,) = seen.requests
    assert str(request.url) == APNS + "ab12"
    assert request.headers["apns-topic"] == "dev.interval.app"
    assert request.headers["apns-push-type"] == "alert"
    assert request.headers["authorization"].startswith("bearer ")
    assert json.loads(request.content) == {
        "aps": {"alert": {"title": "Hi", "body": "There"}}
    }
    # The provider token is reused, not made per push.
    sender.send(NativeTarget("ios", "cd34"), "Hi", "There")
    assert seen.requests[1].headers["authorization"] == request.headers["authorization"]


@pytest.mark.parametrize(
    ("reply", "outcome"),
    [
        (httpx.Response(410, json={"reason": "Unregistered"}), "gone"),
        # A wrong environment or topic says this too: never a reason to drop the token.
        (httpx.Response(400, json={"reason": "BadDeviceToken"}), "failed"),
        (httpx.Response(400, json={"reason": "PayloadTooLarge"}), "failed"),
        (httpx.Response(500), "failed"),
    ],
)
def test_apns_answers_mean_gone_or_failed(reply: httpx.Response, outcome: str) -> None:
    sender, _ = _sender({APNS: reply})
    assert sender.send(NativeTarget("ios", "ab12"), "Hi", "There") == outcome


def test_an_android_push_gets_a_token_once_then_goes_to_fcm() -> None:
    sender, seen = _sender(
        {
            TOKEN_URL: httpx.Response(
                200, json={"access_token": "ya29.x", "expires_in": 3599}
            ),
            FCM: httpx.Response(200, json={"name": "projects/proj/messages/1"}),
        }
    )
    assert sender.send(NativeTarget("android", "fcm:1"), "Hi", "There") == "sent"
    assert sender.send(NativeTarget("android", "fcm:2"), "Hi", "There") == "sent"
    urls = [str(r.url) for r in seen.requests]
    assert urls == [TOKEN_URL, FCM, FCM]  # the access token is reused
    assert seen.requests[1].headers["authorization"] == "Bearer ya29.x"
    assert json.loads(seen.requests[1].content) == {
        "message": {
            "token": "fcm:1",
            "notification": {"title": "Hi", "body": "There"},
        }
    }


@pytest.mark.parametrize(
    ("reply", "outcome"),
    [
        (
            httpx.Response(
                404,
                json={
                    "error": {
                        "status": "NOT_FOUND",
                        "details": [
                            {
                                "@type": FCM_ERROR,
                                "errorCode": "UNREGISTERED",
                            }
                        ],
                    }
                },
            ),
            "gone",
        ),
        # A bare 404 (a wrong project id in the path) mustn't drop every token.
        (httpx.Response(404, json={"error": {"status": "NOT_FOUND"}}), "failed"),
    ],
)
def test_only_fcms_unregistered_is_gone(reply: httpx.Response, outcome: str) -> None:
    sender, _ = _sender(
        {
            TOKEN_URL: httpx.Response(
                200, json={"access_token": "t", "expires_in": 3599}
            ),
            FCM: reply,
        }
    )
    assert sender.send(NativeTarget("android", "fcm:1"), "Hi", "There") == outcome


def test_a_platform_not_configured_fails_without_a_request() -> None:
    recorder = _Recorder({})
    sender = HttpNativePush(
        httpx.Client(transport=httpx.MockTransport(recorder)),
        None,
        None,
        clock=lambda: NOW,
    )
    assert sender.send(NativeTarget("ios", "ab12"), "Hi", "There") == "failed"
    assert recorder.requests == []


class _Fake:
    def __init__(self, outcomes: dict[str, Literal["sent", "gone", "failed"]]) -> None:
        self.outcomes = outcomes

    def send(
        self, target: NativeTarget, title: str, body: str, url: str | None = None
    ) -> Literal["sent", "gone", "failed"]:
        return self.outcomes[target.token]


def test_delivery_counts_each_phone_and_lists_the_gone() -> None:
    out = deliver(
        _Fake({"a": "sent", "b": "gone", "c": "failed"}),
        [NativeTarget("ios", t) for t in "abc"],
        "Hi",
        "There",
    )
    assert (out.sent, out.failed, out.gone) == (1, 1, ["b"])


def test_the_memory_store_gives_a_users_phones_and_drops_one() -> None:
    store = InMemoryDeviceTokens()
    store.rows["u1"] = [NativeTarget("ios", "a"), NativeTarget("android", "b")]
    assert store.for_user("u1") == [
        NativeTarget("ios", "a"),
        NativeTarget("android", "b"),
    ]
    store.drop("a")
    assert store.for_user("u1") == [NativeTarget("android", "b")]


# The owner's push-test: the account's phones, the dead ones dropped.
def test_push_test_sends_to_the_users_phones_and_drops_the_gone() -> None:
    store = InMemoryDeviceTokens()
    store.rows["u1"] = [NativeTarget("ios", "a"), NativeTarget("ios", "b")]
    out = push_test(_Fake({"a": "sent", "b": "gone"}), store, "u1")
    assert (out.sent, out.gone) == (1, ["b"])
    assert store.for_user("u1") == [NativeTarget("ios", "a")]


def _pem(key: ec.EllipticCurvePrivateKey | rsa.RSAPrivateKey) -> bytes:
    return key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )


def test_compose_turns_each_platform_on_only_with_usable_secrets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name in ("APNS_KEY", "APNS_KEY_ID", "APNS_TEAM_ID", "FCM_SERVICE_ACCOUNT"):
        monkeypatch.delenv(name, raising=False)
    assert compose.native_push() is None
    # A deployment's generated placeholders: off, not an error.
    monkeypatch.setenv("APNS_KEY", "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH")
    monkeypatch.setenv("APNS_KEY_ID", "placeholder1")
    monkeypatch.setenv("APNS_TEAM_ID", "placeholder2")
    monkeypatch.setenv(
        "FCM_SERVICE_ACCOUNT", "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH"
    )
    assert compose.native_push() is None
    monkeypatch.setenv("APNS_KEY", base64.b64encode(_pem(EC_KEY)).decode())
    assert compose.native_push() is not None
    monkeypatch.setenv("APNS_KEY", "placeholder")
    account = {
        "project_id": "proj",
        "client_email": "push@proj.iam.gserviceaccount.com",
        "private_key": _pem(RSA_KEY).decode(),
    }
    monkeypatch.setenv(
        "FCM_SERVICE_ACCOUNT", base64.b64encode(json.dumps(account).encode()).decode()
    )
    assert compose.native_push() is not None


class _Raising:
    def send(
        self, target: NativeTarget, title: str, body: str, url: str | None = None
    ) -> Literal["sent", "gone", "failed"]:
        if target.token == "b":
            raise httpx.ConnectError("down")
        return "sent"


def test_one_phone_raising_stops_none() -> None:
    out = deliver(_Raising(), [NativeTarget("ios", t) for t in "abc"], "Hi", "There")
    assert (out.sent, out.failed, out.gone) == (2, 1, [])


# P4-W24-S01b: an opt-in push names the page a tap opens in the app.
def test_a_push_with_a_page_carries_it_to_both_platforms() -> None:
    sender, seen = _sender(
        {
            APNS: httpx.Response(200),
            TOKEN_URL: httpx.Response(
                200, json={"access_token": "t", "expires_in": 3599}
            ),
            FCM: httpx.Response(200, json={"name": "m"}),
        }
    )
    sender.send(NativeTarget("ios", "ab12"), "Hi", "There", "/paths/3")
    sender.send(NativeTarget("android", "fcm:1"), "Hi", "There", "/play")
    apns, _, fcm = seen.requests
    assert json.loads(apns.content) == {
        "aps": {"alert": {"title": "Hi", "body": "There"}},
        "url": "/paths/3",
    }
    assert json.loads(fcm.content)["message"]["data"] == {"url": "/play"}
