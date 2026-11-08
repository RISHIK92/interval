"""NativePush adapter (P4-W19-S04b): APNs over HTTP/2 (h2) and FCM's HTTP v1 API, over
httpx. Only Apple's and Google's hosts are ever contacted (constants here)."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal, cast

import httpx
from cryptography.hazmat.primitives.asymmetric import ec, rsa

from interval_jobs import log
from interval_jobs.native_push import GOOGLE_TOKEN_URL, apns_jwt, fcm_assertion
from interval_jobs.ports import NativeTarget

# The app's bundle id (apps/mobile/app.json `ios.bundleIdentifier`); W22-S05's store id
# replaces both.
APNS_TOPIC = "dev.interval.app"
APNS_HOSTS = {False: "api.push.apple.com", True: "api.sandbox.push.apple.com"}
# Apple wants a provider token renewed within the hour, at most every 20 minutes.
APNS_TOKEN_FOR = timedelta(minutes=50)

Outcome = Literal["sent", "gone", "failed"]


@dataclass(frozen=True)
class ApnsConfig:
    team_id: str
    key_id: str
    key: ec.EllipticCurvePrivateKey
    sandbox: bool  # development builds use APNs' sandbox


@dataclass(frozen=True)
class FcmConfig:
    project_id: str
    client_email: str
    key: rsa.RSAPrivateKey


class HttpNativePush:
    def __init__(
        self,
        http: httpx.Client,
        apns: ApnsConfig | None,
        fcm: FcmConfig | None,
        clock: Callable[[], datetime],
    ) -> None:
        self._http = http
        self._apns = apns
        self._fcm = fcm
        self._clock = clock
        self._apns_token: tuple[str, datetime] | None = None
        self._fcm_token: tuple[str, datetime] | None = None

    def send(self, target: NativeTarget, title: str, body: str) -> Outcome:
        if target.platform == "ios":
            return self._send_apns(target.token, title, body)
        return self._send_fcm(target.token, title, body)

    def _send_apns(self, token: str, title: str, body: str) -> Outcome:
        if self._apns is None:
            return "failed"
        now = self._clock()
        if self._apns_token is None or now - self._apns_token[1] >= APNS_TOKEN_FOR:
            a = self._apns
            self._apns_token = (apns_jwt(a.team_id, a.key_id, a.key, now), now)
        response = self._http.post(
            f"https://{APNS_HOSTS[self._apns.sandbox]}/3/device/{token}",
            json={"aps": {"alert": {"title": title, "body": body}}},
            headers={
                "authorization": f"bearer {self._apns_token[0]}",
                "apns-topic": APNS_TOPIC,
                "apns-push-type": "alert",
            },
            timeout=10,
        )
        if response.status_code == 200:
            return "sent"
        # Only 410 means the token is dead: BadDeviceToken and DeviceTokenNotForTopic
        # also come from a wrong environment or topic, which mustn't drop tokens.
        if response.status_code == 410:
            return "gone"
        log.error(
            "push: APNs refused",
            status=response.status_code,
            reason=_field(response, ("reason",)),
        )
        return "failed"

    def _access_token(self) -> str | None:
        assert self._fcm is not None
        now = self._clock()
        if self._fcm_token is not None and now < self._fcm_token[1]:
            return self._fcm_token[0]
        response = self._http.post(
            GOOGLE_TOKEN_URL,
            data={
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": fcm_assertion(self._fcm.client_email, self._fcm.key, now),
            },
            timeout=10,
        )
        if response.status_code != 200:
            log.error(
                "push: FCM token refused",
                status=response.status_code,
                error=_field(response, ("error",)),
            )
            return None
        reply = response.json()
        # A minute's margin before Google's expiry.
        expires = now + timedelta(seconds=int(reply["expires_in"]) - 60)
        self._fcm_token = (str(reply["access_token"]), expires)
        return self._fcm_token[0]

    def _send_fcm(self, token: str, title: str, body: str) -> Outcome:
        if self._fcm is None:
            return "failed"
        access = self._access_token()
        if access is None:
            return "failed"
        response = self._http.post(
            f"https://fcm.googleapis.com/v1/projects/{self._fcm.project_id}/messages:send",
            json={
                "message": {
                    "token": token,
                    "notification": {"title": title, "body": body},
                }
            },
            headers={"authorization": f"Bearer {access}"},
            timeout=10,
        )
        if response.status_code == 200:
            return "sent"
        # Only FCM's own UNREGISTERED: a bare 404 is also a wrong project id.
        if _fcm_unregistered(response):
            return "gone"
        log.error(
            "push: FCM refused",
            status=response.status_code,
            error=_field(response, ("error", "status")),
        )
        return "failed"


def _get(value: object, key: str) -> object:
    return (
        cast("dict[str, object]", value).get(key) if isinstance(value, dict) else None
    )


def _field(response: httpx.Response, path: tuple[str, ...]) -> str | None:
    """A string in the reply's JSON at `path`, for the log; None when it isn't one."""
    try:
        value: object = response.json()
    except ValueError:
        return None
    for key in path:
        value = _get(value, key)
    return value if isinstance(value, str) else None


def _fcm_unregistered(response: httpx.Response) -> bool:
    """FCM's own UNREGISTERED (google.firebase.fcm.v1.FcmError) in the error details."""
    try:
        reply: object = response.json()
    except ValueError:
        return False
    details = _get(_get(reply, "error"), "details")
    if not isinstance(details, list):
        return False
    return any(
        _get(d, "errorCode") == "UNREGISTERED" for d in cast("list[object]", details)
    )
