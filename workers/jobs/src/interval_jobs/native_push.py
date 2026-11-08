"""Native push (P4-W19-S04b, Q-P4-03; owner, 2026-11-07): the worker sends straight to
Apple's (APNs) and Google's (FCM) services, with no Expo push service in between."""

from dataclasses import dataclass, field
from datetime import datetime

import httpx
from cryptography.hazmat.primitives.asymmetric import ec, rsa

from interval_jobs import log
from interval_jobs.jwt import es256, rs256
from interval_jobs.ports import DeviceTokens, NativePush, NativeTarget

FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"


def apns_jwt(
    team_id: str, key_id: str, key: ec.EllipticCurvePrivateKey, now: datetime
) -> str:
    """APNs' provider token: Apple refuses one older than an hour."""
    return es256({"kid": key_id}, {"iss": team_id, "iat": int(now.timestamp())}, key)


def fcm_assertion(client_email: str, key: rsa.RSAPrivateKey, now: datetime) -> str:
    """The service account's request for an FCM access token (an hour at most)."""
    epoch = int(now.timestamp())
    return rs256(
        {
            "iss": client_email,
            "scope": FCM_SCOPE,
            "aud": GOOGLE_TOKEN_URL,
            "iat": epoch,
            "exp": epoch + 3600,
        },
        key,
    )


@dataclass
class Delivered:
    sent: int = 0
    failed: int = 0
    gone: list[str] = field(default_factory=list[str])


def deliver(
    sender: NativePush, targets: list[NativeTarget], title: str, body: str
) -> Delivered:
    """Each phone once; one failing stops none. The caller drops the gone tokens."""
    out = Delivered()
    for target in targets:
        try:
            outcome = sender.send(target, title, body)
        except (httpx.HTTPError, ValueError, KeyError) as error:
            # A network or protocol failure on one phone; never the token or the key.
            log.error(
                "push: native failed",
                platform=target.platform,
                error=type(error).__name__,
            )
            outcome = "failed"
        if outcome == "sent":
            out.sent += 1
        elif outcome == "gone":
            out.gone.append(target.token)
        else:
            out.failed += 1
    return out


def push_test(sender: NativePush, tokens: DeviceTokens, user_id: str) -> Delivered:
    """The owner's check that a phone gets pushes (`push-test`); dead tokens dropped."""
    out = deliver(
        sender, tokens.for_user(user_id), "Test notification", "Native push works."
    )
    for token in out.gone:
        tokens.drop(token)
    return out
