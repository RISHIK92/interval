"""The pipeline on the real Postgres store (rolled back): the stages' store queries,
rights checks and idempotent upserts against the actual schema and triggers."""

import threading
from collections.abc import Generator
from contextlib import contextmanager

import psycopg

from interval_jobs.adapters.memory_queue import InMemoryQueue
from interval_jobs.adapters.postgres import PostgresStore
from interval_jobs.adapters.trafilatura_extractor import TrafilaturaExtractor
from interval_jobs.pipeline import STAGES, Pipeline, StageServices

from .test_pipeline import FEED_URL, WAL, web


def test_the_pipeline_runs_end_to_end_on_postgres(conn: psycopg.Connection) -> None:
    store = PostgresStore(conn)
    source_id = store.sources.upsert(
        name="pipe-pg",
        feed_url=FEED_URL,
        rights_profile="full_text_internal",
        homepage=None,
    )
    conn.execute(
        "update source set moments_seeded = true, moments_enabled = true where id = %s",
        (source_id,),
    )
    queue = InMemoryQueue()
    fetcher = web()

    @contextmanager
    def unit() -> Generator[StageServices]:
        yield StageServices(store, fetcher, TrafilaturaExtractor())

    handlers = Pipeline(unit, queue).handlers()
    for poll in ("poll-1", "poll-2"):  # the second poll must change nothing
        queue.enqueue("discover_source", {"source_id": source_id}, idempotency_key=poll)
        while any(queue.pending(name) for name in STAGES):
            for name in STAGES:
                queue.consume(name, handlers[name], threading.Event())

    items = conn.execute(
        "select count(*) from content_item where source_id = %s", (source_id,)
    ).fetchone()
    assert items == (2,)
    moments = conn.execute(
        "select count(*) from moment m "
        "join content_item ci on ci.id = m.content_item_id "
        "where ci.source_id = %s",
        (source_id,),
    ).fetchone()
    assert moments is not None and moments[0] > 0
    assert [url for url, _ in fetcher.requested].count(WAL) == 1
    assert queue.failed_messages("fetch_item") == []
