"""WebPush adapter (P3-W17-S05b): one encrypted push, signed with VAPID, over httpx."""

from datetime import UTC, datetime

import httpx
from cryptography.hazmat.primitives.asymmetric import ec

from interval_jobs.ports import PushTarget
from interval_jobs.webpush import encrypt, vapid_header


class HttpWebPush:
    def __init__(
        self, http: httpx.Client, key: ec.EllipticCurvePrivateKey, subject: str
    ) -> None:
        self._http = http
        self._key = key
        self._subject = subject

    def push(self, target: PushTarget, text: str) -> int:
        body = encrypt(text.encode(), target.p256dh, target.auth)
        response = self._http.post(
            target.endpoint,
            content=body,
            headers={
                "Authorization": vapid_header(
                    target.endpoint, self._key, self._subject, datetime.now(UTC)
                ),
                "Content-Encoding": "aes128gcm",
                "Content-Type": "application/octet-stream",
                # A nudge is worth a minute at most (§7: 45 s into a task).
                "TTL": "60",
                "Urgency": "high",
            },
            timeout=10,
        )
        return response.status_code
