"""Source rows.

Temporary CLI path until the seed-list loader (P1-W2-S01) replaces it.
"""

import psycopg

from interval_db.generated import RightsProfile


def upsert_source(
    conn: psycopg.Connection,
    *,
    name: str,
    feed_url: str,
    rights_profile: RightsProfile,
    homepage: str | None,
) -> int:
    row = conn.execute(
        """
        insert into source (name, feed_url, rights_profile, homepage)
        values (%s, %s, %s, %s)
        on conflict (name) do update
          set feed_url = excluded.feed_url,
              rights_profile = excluded.rights_profile,
              homepage = excluded.homepage
        returning id
        """,
        (name, feed_url, rights_profile, homepage),
    ).fetchone()
    if row is None:
        raise RuntimeError("upsert returned no row")
    source_id: int = row[0]
    return source_id
