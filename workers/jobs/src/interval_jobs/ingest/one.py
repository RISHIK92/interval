"""Ingest the newest item of one source: fetch, gate on rights, store (ING-1, ING-2).

The caller owns the transaction; nothing here commits.
"""

from dataclasses import dataclass
from typing import Literal

import httpx
import psycopg
from psycopg.rows import class_row

from interval_db.generated import RightsProfile
from interval_jobs.ingest.extract import extract_text
from interval_jobs.ingest.feed import newest_entry
from interval_jobs.ingest.fetch import Resolver, fetch, resolve_host
from interval_jobs.ingest.structure import extract_sections
from interval_jobs.rights import EXCERPT_MAX_CHARS, allowed
from interval_jobs.segment import segment_item


@dataclass(frozen=True)
class _Source:
    id: int
    feed_url: str
    rights_profile: RightsProfile


@dataclass(frozen=True)
class IngestResult:
    content_item_id: int
    stored: Literal["metadata", "excerpt", "full_text"]


def ingest_one(
    conn: psycopg.Connection,
    http: httpx.Client,
    source_id: int,
    resolve: Resolver = resolve_host,
) -> IngestResult:
    with conn.cursor(row_factory=class_row(_Source)) as cur:
        source = cur.execute(
            "select id, feed_url, rights_profile from source where id = %s",
            (source_id,),
        ).fetchone()
    if source is None:
        raise LookupError(f"no source with id {source_id}")
    profile = source.rights_profile

    feed = fetch(http, source.feed_url, "feed", resolve)
    entry = newest_entry(feed.body, feed.url)

    # The upsert also drops an excerpt the current profile no longer allows.
    row = conn.execute(
        """
        insert into content_item
          (source_id, guid, canonical_url, title, author, published_at, feed_summary)
        values (%s, %s, %s, %s, %s, %s, %s)
        on conflict (source_id, guid) do update
          set canonical_url = excluded.canonical_url,
              title = excluded.title,
              author = excluded.author,
              published_at = excluded.published_at,
              feed_summary = excluded.feed_summary,
              excerpt = case when %s then content_item.excerpt end,
              fetched_at = now()
        returning id
        """,
        (
            source.id,
            entry.guid,
            entry.link,
            entry.title,
            entry.author,
            entry.published_at,
            entry.summary,
            allowed(profile, "store_excerpt"),
        ),
    ).fetchone()
    if row is None:
        raise RuntimeError("upsert returned no row")
    item_id: int = row[0]

    if not allowed(profile, "store_full_text"):
        conn.execute(
            "delete from content_item_private_text where content_item_id = %s",
            (item_id,),
        )

    if not allowed(profile, "fetch_body"):
        return IngestResult(content_item_id=item_id, stored="metadata")

    article = fetch(http, entry.link, "article", resolve)
    text = extract_text(article.body, article.encoding)

    if allowed(profile, "store_full_text"):
        conn.execute(
            """
            insert into content_item_private_text (content_item_id, text)
            values (%s, %s)
            on conflict (content_item_id) do update
              set text = excluded.text, extracted_at = now()
            """,
            (item_id, text),
        )
        # Heading structure for segmentation (ING-4): headings and counts, no text.
        conn.execute(
            "delete from content_item_section where content_item_id = %s", (item_id,)
        )
        with conn.cursor() as cur:
            cur.executemany(
                "insert into content_item_section "
                "(content_item_id, ordinal, heading, level, anchor_id, word_count) "
                "values (%s, %s, %s, %s, %s, %s)",
                [
                    (item_id, i, s.heading, s.level, s.anchor_id, s.word_count)
                    for i, s in enumerate(
                        extract_sections(article.body, article.encoding, entry.title)
                    )
                ],
            )
        # Moments always match the stored structure (owner, 2026-10-25).
        segment_item(conn, item_id)
        return IngestResult(content_item_id=item_id, stored="full_text")

    if allowed(profile, "store_excerpt"):
        conn.execute(
            "update content_item set excerpt = %s where id = %s",
            (text[:EXCERPT_MAX_CHARS], item_id),
        )
        return IngestResult(content_item_id=item_id, stored="excerpt")

    raise AssertionError(f"profile {profile} fetches a body but stores none")
