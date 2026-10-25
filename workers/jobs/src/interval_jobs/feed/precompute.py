"""Precomputed feed (CACHE-1): the worker writes it; the web app reads only
`feed_visible` (ADR-0008). Works through ports (ADR-0012).

The placeholder order (newest item first, then sections in reading order) lives in the
store adapters until ranking (REC-1, REC-2) moves it into logic in Week 4.
"""

from interval_jobs.ports import Store


def rebuild_feed(store: Store) -> int:
    return store.feed.rebuild()
