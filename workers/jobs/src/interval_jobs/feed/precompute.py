"""Precomputed feed (CACHE-1): the worker writes `feed_entry`; the web app reads only
`feed_visible` (ADR-0008).

Placeholder order until ranking (REC-1, REC-2) in Week 4: newest item first, then its
sections in reading order. The caller owns the transaction.
"""

import psycopg

# Serialises rebuilds: two concurrent delete+insert runs would collide on the primary
# key (LOAD-5: jobs may run more than once and side by side).
FEED_LOCK_KEY = 0x1E_ED_F0_0D


def rebuild_feed(conn: psycopg.Connection) -> int:
    conn.execute("select pg_advisory_xact_lock(%s)", (FEED_LOCK_KEY,))
    conn.execute("delete from feed_entry")
    cursor = conn.execute(
        """
        insert into feed_entry (moment_id, rank)
        select m.id,
               row_number() over (
                 order by ci.published_at desc nulls last, ci.id desc, m.ordinal
               )
        from moment m
        join content_item ci on ci.id = m.content_item_id
        """
    )
    return cursor.rowcount
