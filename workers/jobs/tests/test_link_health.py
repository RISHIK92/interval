"""Weekly link health checks (ING-6, Q-P1-38, P1-W6-S03): a 404 or 410 marks an item's
link broken and takes it out of the feed; a later 200 brings it back; a 5xx is left to
the queue's retries; anything else changes nothing (owner, 2026-10-26)."""

from collections.abc import Mapping
from datetime import UTC, datetime, timedelta

import pytest

from interval_db.messages import MessageName
from interval_jobs.adapters.memory import FakeFetcher, InMemoryStore, shown_items
from interval_jobs.link_health import check_link, queue_link_checks
from interval_jobs.ports import (
    FeedEntry,
    Fetched,
    FetchError,
    FetchStatusError,
    MomentRow,
    RobotsDisallowed,
)

NOW = datetime(2026, 10, 26, 12, tzinfo=UTC)
URL = "https://blog.example.test/post"


def item(store: InMemoryStore, guid: str = "g", url: str = URL) -> int:
    source = store.sources.upsert(
        name="Blog",
        feed_url="https://blog.example.test/feed.xml",
        rights_profile="metadata_only",  # status only: no body is ever fetched
        homepage=None,
    )
    return store.items.upsert_from_feed(
        source,
        FeedEntry(
            guid=guid,
            link=url,
            title="Post",
            author=None,
            published_at=None,
            updated_at=None,
            summary=None,
        ),
        keep_excerpt=False,
    )


def web(answer: Fetched | FetchError) -> FakeFetcher:
    return FakeFetcher({URL: answer})


OK = Fetched(URL, b"", None)


@pytest.mark.parametrize("status", [404, 410])
def test_a_gone_page_marks_the_link_broken(status: int) -> None:
    store = InMemoryStore()
    item_id = item(store)
    fetcher = web(FetchStatusError("gone", status))
    assert check_link(store, fetcher, item_id, NOW) == "broken"
    assert store.items.link_health(item_id) == (URL, NOW)
    assert fetcher.checked == [URL]
    assert fetcher.requested == []  # never a body fetch


def test_a_second_miss_keeps_when_it_first_broke() -> None:
    store = InMemoryStore()
    item_id = item(store)
    check_link(store, web(FetchStatusError("gone", 404)), item_id, NOW)
    later = NOW + timedelta(days=7)
    check_link(store, web(FetchStatusError("gone", 404)), item_id, later)
    assert store.items.link_health(item_id) == (URL, NOW)


def test_a_page_that_works_again_comes_back() -> None:
    store = InMemoryStore()
    item_id = item(store)
    check_link(store, web(FetchStatusError("gone", 404)), item_id, NOW)
    assert check_link(store, web(OK), item_id, NOW + timedelta(days=7)) == "fine"
    assert store.items.link_health(item_id) == (URL, None)


def test_a_server_error_is_raised_for_the_queue_to_retry() -> None:
    store = InMemoryStore()
    item_id = item(store)
    with pytest.raises(FetchStatusError):
        check_link(store, web(FetchStatusError("down", 503)), item_id, NOW)
    assert store.items.link_health(item_id) == (URL, None)


@pytest.mark.parametrize(
    "error",
    [RobotsDisallowed("robots"), FetchStatusError("forbidden", 403), FetchError("x")],
)
def test_anything_else_changes_nothing(error: FetchError) -> None:
    store = InMemoryStore()
    item_id = item(store)
    check_link(store, web(FetchStatusError("gone", 404)), item_id, NOW)
    assert check_link(store, web(error), item_id, NOW) == "unchanged"
    assert store.items.link_health(item_id) == (URL, NOW)  # still broken, as it was


def test_an_item_deleted_since_queueing_is_skipped() -> None:
    assert check_link(InMemoryStore(), web(OK), 999, NOW) == "unchanged"


class RecordingQueue:
    def __init__(self) -> None:
        self.sent: list[tuple[MessageName, Mapping[str, object], str]] = []

    def enqueue(
        self,
        name: MessageName,
        message: Mapping[str, object],
        idempotency_key: str,
        delay_seconds: int = 0,
    ) -> None:
        self.sent.append((name, message, idempotency_key))


def test_every_item_is_queued_once_a_week_broken_ones_too() -> None:
    store = InMemoryStore()
    fine, broken = item(store, "a"), item(store, "b", "https://blog.example.test/b")
    store.items.set_link_broken(broken, NOW)
    queue = RecordingQueue()
    assert queue_link_checks(store, queue, NOW) == 2
    assert {m["content_item_id"] for _, m, _ in queue.sent} == {fine, broken}
    assert {name for name, _, _ in queue.sent} == {"check_link"}
    first = {key for _, _, key in queue.sent}
    # Again the same week: the same keys, so duplicates still pending collapse.
    queue_link_checks(store, queue, NOW + timedelta(days=2))
    assert {key for _, _, key in queue.sent[2:]} == first
    # The next week: new keys.
    queue_link_checks(store, queue, NOW + timedelta(days=7))
    assert not {key for _, _, key in queue.sent[4:]} & first


def test_a_broken_item_is_not_offered_to_ranking() -> None:
    store = InMemoryStore()
    source = store.sources.upsert(
        name="Full",
        feed_url="https://full.example.test/feed.xml",
        rights_profile="full_text_internal",
        homepage=None,
    )
    store.sources.set_moments_enabled(source, True)
    item_id = store.items.upsert_from_feed(
        source,
        FeedEntry(
            guid="m",
            link="https://full.example.test/m",
            title="M",
            author=None,
            published_at=None,
            updated_at=None,
            summary=None,
        ),
        keep_excerpt=False,
    )
    store.moments.replace(
        item_id, [MomentRow(0, "M", 1, "https://full.example.test/m", "page_top")]
    )
    assert item_id in shown_items(store)
    store.items.set_link_broken(item_id, NOW)
    assert item_id not in shown_items(store)


def test_the_weekly_key_follows_the_iso_week_across_new_year() -> None:
    def keys(day: datetime) -> set[str]:
        store, queue = InMemoryStore(), RecordingQueue()
        item(store)
        queue_link_checks(store, queue, day)
        return {key for _, _, key in queue.sent}

    new_years_eve = keys(datetime(2026, 12, 31, tzinfo=UTC))
    assert new_years_eve == keys(datetime(2027, 1, 1, tzinfo=UTC))
    assert all(k.endswith("2026-W53") for k in new_years_eve)
    assert all(k.endswith("2027-W01") for k in keys(datetime(2027, 1, 4, tzinfo=UTC)))
