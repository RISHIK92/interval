"""Weekly link health checks (ING-6, Q-P1-38, P1-W6-S03).

`check-links-due` queues a check of every stored item's own URL once a week (EventBridge
Scheduler or the VM's interval-links.timer runs it); the consumer's check_link stage
reads only the page's status. A 404 or 410 marks the link broken, which takes the item
out of every feed at once (the *_feed_visible views) and out of ranking; a later 200
clears it. A 5xx is raised for the queue to retry, then parks as failed and is checked
again next week; robots.txt, 403s and other failures change nothing (owner,
2026-10-26). Only the status is read, so any rights profile allows it (ING-2).
"""

from datetime import datetime
from typing import Literal

from interval_jobs import log
from interval_jobs.ports import (
    Fetcher,
    FetchError,
    FetchStatusError,
    JobQueue,
    Store,
)

_GONE = (404, 410)

type LinkState = Literal["fine", "broken", "unchanged"]


def check_link(
    store: Store, fetcher: Fetcher, item_id: int, now: datetime
) -> LinkState:
    health = store.items.link_health(item_id)
    if health is None:
        return "unchanged"  # deleted since it was queued
    url, broken_at = health
    try:
        fetcher.check(url)
    except FetchStatusError as error:
        if error.status in _GONE:
            if broken_at is None:
                log.warn(
                    "links: item link broken",
                    item_id=item_id,
                    url=url,
                    status=error.status,
                )
            store.items.set_link_broken(item_id, now)
            return "broken"
        if error.status >= 500:
            raise  # the queue retries; a lasting 5xx changes nothing
        log.warn(
            "links: item link not checked",
            item_id=item_id,
            url=url,
            status=error.status,
        )
        return "unchanged"
    except FetchError as error:
        log.warn(
            "links: item link not checked", item_id=item_id, url=url, error=str(error)
        )
        return "unchanged"
    if broken_at is not None:
        log.info("links: item link works again", item_id=item_id)
    store.items.set_link_broken(item_id, None)
    return "fine"


def queue_link_checks(store: Store, queue: JobQueue, now: datetime) -> int:
    """One check per item, keyed by ISO week so duplicates still pending collapse.
    A repeat run after the checks have finished checks again; that's harmless, since
    a check is idempotent (the first broken mark is kept)."""
    year, week, _ = now.isocalendar()
    ids = store.items.ids()
    for item_id in ids:
        queue.enqueue(
            "check_link",
            {"content_item_id": item_id},
            idempotency_key=f"check-link-{item_id}-{year}-W{week:02d}",
        )
    return len(ids)
