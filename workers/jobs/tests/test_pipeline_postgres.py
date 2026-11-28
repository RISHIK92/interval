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
    stored = conn.execute(
        "select count(*) filter (where pt.content_item_id is not null) "
        "from content_item ci "
        "left join content_item_private_text pt on pt.content_item_id = ci.id "
        "where ci.source_id = %s",
        (source_id,),
    ).fetchone()
    assert stored == (2,)
    assert [url for url, _ in fetcher.requested].count(WAL) == 1
    assert queue.failed_messages("fetch_item") == []
