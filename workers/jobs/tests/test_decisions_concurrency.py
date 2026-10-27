"""Two writers saving the same answers at once (Postgres only): the pipeline and an
eval run both write a decision model's answers, and the second must wait for the
first, then replace its answers, not fail on a key."""

import os
import threading
from collections.abc import Callable, Iterator

import psycopg
import pytest

from interval_jobs.adapters.postgres import PostgresStore
from interval_jobs.ports import FeedEntry, MomentRow

URL = os.environ.get("DATABASE_URL", "")
NAME = "decisions-concurrency-test"
SLUG = "decisions-concurrency-test"
MODEL = "perplexity/pplx-decider-v1.2"

# (store, item id, moment id, hash, probability) -> one save
Save = Callable[[PostgresStore, int, int, str, float], None]


def cleanup() -> None:
    with psycopg.connect(URL) as conn:
        conn.execute(
            "delete from content_item where source_id in "
            "(select id from source where name = %s)",
            (NAME,),
        )
        conn.execute("delete from source where name = %s", (NAME,))


@pytest.fixture
def ids() -> Iterator[tuple[int, int]]:
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
        conn.execute(
            "update source set moments_seeded = true, moments_enabled = true "
            "where id = %s",
            (sid,),
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
        s.moments.replace(
            item,
            [MomentRow(0, "a", 1, "https://concurrency.example.test/a", "page_top")],
        )
        row = conn.execute(
            "select id from moment where content_item_id = %s", (item,)
        ).fetchone()
        assert row is not None
    yield item, int(row[0])
    cleanup()


def save_moment(s: PostgresStore, _item: int, moment: int, h: str, p: float) -> None:
    s.decisions.save_moment(moment, MODEL, h, 1.0, {SLUG: p})


def save_item(s: PostgresStore, item: int, _moment: int, h: str, p: float) -> None:
    s.decisions.save_item(item, MODEL, h, 1.0, {SLUG: p})


@pytest.mark.parametrize("save", [save_moment, save_item])
def test_a_second_writer_waits_for_the_first_and_then_replaces_its_answers(
    ids: tuple[int, int], save: Save
) -> None:
    item, moment = ids
    errors: list[BaseException] = []
    with psycopg.connect(URL) as first:
        save(PostgresStore(first), item, moment, "h1", 0.2)

        def second() -> None:
            try:
                with psycopg.connect(URL) as conn:
                    save(PostgresStore(conn), item, moment, "h2", 0.9)
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
        assert s.decisions.moment_hashes(item, MODEL) == (
            {moment: "h2"} if save is save_moment else {}
        )
        if save is save_item:
            assert s.decisions.item_hash(item, MODEL) == "h2"
        got = s.decisions.read(item, MODEL)
        answers = got.moments[moment][1] if save is save_moment else got.item
        assert answers == {SLUG: 0.9}
