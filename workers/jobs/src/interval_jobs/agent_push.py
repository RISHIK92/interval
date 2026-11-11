"""The agent hook's nudge (P3-W17-S05b, §7, Q-P3-18; owner, 2026-11-03): about 45
seconds after "started", if the task still runs, each browser its player subscribed
gets "open Interval for a quick session". Nothing about the task is in it."""

import json
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from interval_jobs import log
from interval_jobs.ports import PushTarget, WebPush

# The notification the service worker shows (apps/web/public/sw.js).
NOTICE = json.dumps(
    {
        "title": "Your agent is still working",
        "body": "Open Interval for a quick session",
        "url": "/",
    }
)
GONE = {404, 410}  # RFC 8030: the subscription expired or was removed

# The browsers' push services: a subscription anywhere else is never posted to, so a
# stored endpoint can't point the worker at another host (the web app checks this too).
PUSH_HOSTS = ("fcm.googleapis.com", "updates.push.services.mozilla.com")
PUSH_DOMAINS = (".push.apple.com", ".notify.windows.com")


def push_service(endpoint: str) -> bool:
    parts = urlsplit(endpoint)
    host = parts.hostname or ""
    return (
        parts.scheme == "https"
        and parts.port in (None, 443)
        and (host in PUSH_HOSTS or host.endswith(PUSH_DOMAINS))
    )


@dataclass
class Delivered:
    sent: int = 0
    failed: int = 0
    gone: list[str] = field(default_factory=list[str])


def deliver(
    push: WebPush, targets: list[PushTarget], text: str, what: str = "agent"
) -> Delivered:
    """One push per browser; one that fails doesn't stop the rest. A late nudge is
    useless, so a failure is logged (and counted by its metric), never retried."""
    out = Delivered()
    for target in targets:
        if not push_service(target.endpoint):
            out.failed += 1
            log.error(f"{what}: push failed", reason="not a push service")
            continue
        try:
            status = push.push(target, text)
        except Exception as error:  # a bad key or a dead endpoint: this browser only
            out.failed += 1
            log.error(f"{what}: push failed", error=type(error).__name__)
            continue
        if status in GONE:
            out.gone.append(target.endpoint)
        elif status >= 400:
            out.failed += 1
            log.error(f"{what}: push failed", status=status)
        else:
            out.sent += 1
    return out
