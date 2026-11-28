"""Two writers saving the same answers at once (Postgres only): the pipeline and an
eval run both write a decision model's answers, and the second must wait for the
first, then replace its answers, not fail on a key."""

import os
import threading
from collections.abc import Iterator

import psycopg
import pytest

from interval_jobs.adapters.postgres import PostgresStore
from interval_jobs.ports import FeedEntry

URL = os.environ.get("DATABASE_URL", "")
NAME = "decisions-concurrency-test"
SLUG = "decisions-concurrency-test"
MODEL = "perplexity/pplx-decider-v1.2"


def cleanup() -> None:
    with psycopg.connect(URL) as conn:
        conn.execute(
            "delete from content_item where source_id in "
            "(select id from source where name = %s)",
            (NAME,),
        )
        conn.execute("delete from source where name = %s", (NAME,))


@pytest.fixture
def item_id() -> Iterator[int]:
    assert URL, "DATABASE_URL is not set; copy .env.example to .env"
    cleanup()
    with psycopg.connect(URL) as conn:
        # Retired, so a worker running beside the test never offers it; concepts are
        # never deleted, so it stays for the next run.
        conn.execute(
            "insert into concept (slug, name, topic, retired_at) "
            "values (%s, 'Test', 'databases', now()) on conflict (slug) do nothing",
            (SLUG,),
        )
        s = PostgresStore(conn)
        sid = s.sources.upsert(
            name=NAME,
            feed_url="https://concurrency.example.test/feed.xml",
            rights_profile="full_text_internal",
            homepage=None,
        )
        item = s.items.upsert_from_feed(
            sid,
            FeedEntry(
                guid="g",
                link="https://concurrency.example.test/a",
                title="T",
                author=None,
                published_at=None,
                updated_at=None,
                summary=None,
            ),
            keep_excerpt=False,
        )
    yield item
    cleanup()


def save(s: PostgresStore, item: int, h: str, p: float) -> None:
    s.decisions.save_item(item, MODEL, h, 1.0, {SLUG: p}, from_full_text=True)


def test_a_second_writer_waits_for_the_first_and_then_replaces_its_answers(
    item_id: int,
) -> None:
    item = item_id
    errors: list[BaseException] = []
    with psycopg.connect(URL) as first:
        save(PostgresStore(first), item, "h1", 0.2)

        def second() -> None:
            try:
                with psycopg.connect(URL) as conn:
                    save(PostgresStore(conn), item, "h2", 0.9)
            except BaseException as error:  # reported by the assertion below
                errors.append(error)

        writer = threading.Thread(target=second)
        writer.start()
        writer.join(timeout=1)
        assert writer.is_alive()  # blocked behind the first, uncommitted, write
        first.commit()
    writer.join(timeout=10)
    assert errors == []
    with psycopg.connect(URL) as conn:
        s = PostgresStore(conn)
        assert s.decisions.item_hash(item, MODEL) == "h2"
        assert s.decisions.read(item, MODEL).item == {SLUG: 0.9}
