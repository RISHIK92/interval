from datetime import UTC, datetime

import pytest

from interval_jobs.ingest.feed import (
    NoValidEntryError,
    newest_entry,
    plain_summary,
    valid_entries,
)

from .conftest import fixture_bytes

FEED = "https://blog.example.test/feed.atom"


def test_atom_newest_entry_is_picked_by_date_not_position() -> None:
    entry = newest_entry(fixture_bytes("atom.xml"), FEED)
    assert entry.guid == "tag:blog.example.test,2026:wal"
    assert entry.link == "https://blog.example.test/wal"
    assert entry.title == "How our write-ahead log works"
    assert entry.author == "Alex Author"
    assert entry.published_at == datetime(2026, 10, 20, 9, 0, tzinfo=UTC)


def test_summary_never_comes_from_full_content() -> None:
    atom = newest_entry(fixture_bytes("atom.xml"), FEED)
    rss = newest_entry(fixture_bytes("rss.xml"), FEED)
    assert atom.summary == "A short tour of the write-ahead log."
    assert rss.summary == "Why we cache at the edge."


@pytest.mark.parametrize("name", ["rss_content_only.xml", "atom_content_only.xml"])
def test_content_copied_into_summary_by_feedparser_is_dropped(name: str) -> None:
    assert newest_entry(fixture_bytes(name), FEED).summary is None


def test_summary_is_plain_text_capped_at_300() -> None:
    assert (
        plain_summary("<p>Hello <b>bold</b> &amp; friends</p>")
        == "Hello bold & friends"
    )
    assert len(plain_summary("<p>" + "word " * 200 + "</p>") or "") == 300


def test_rss_entry_without_guid_falls_back_to_link() -> None:
    entry = newest_entry(fixture_bytes("rss.xml"), FEED)
    assert entry.guid == "https://rss.example.test/edge-caching"
    assert entry.author is None


def test_relative_link_resolves_and_invalid_entries_are_skipped_with_a_warning(
    capsys: pytest.CaptureFixture[str],
) -> None:
    entry = newest_entry(
        fixture_bytes("rss_mixed.xml"), "https://m.example.test/feed.xml"
    )
    # The javascript: entry is newer but invalid; the untitled one is skipped too.
    assert entry.link == "https://m.example.test/posts/relative"
    assert entry.summary == "Hello bold & friends"
    assert capsys.readouterr().out.count('"msg": "feed: skipped invalid entry"') == 2


def test_updated_date_is_used_only_when_no_entry_has_a_published_date() -> None:
    assert newest_entry(fixture_bytes("atom_updated_only.xml"), FEED).guid == "u2"


def test_feed_without_valid_entries_raises() -> None:
    with pytest.raises(NoValidEntryError):
        newest_entry(fixture_bytes("empty.xml"), FEED)


def test_bytes_that_look_like_a_path_are_not_opened() -> None:
    with pytest.raises(NoValidEntryError):
        newest_entry(b"/etc/hosts", FEED)


def test_entry_links_lose_tracking_params_but_guids_stay_as_published() -> None:
    feed = b"""<rss version="2.0"><channel><title>t</title><item><title>Post</title>
<link>https://blog.example.test/p?utm_source=rss&amp;utm_medium=feed#more</link>
</item></channel></rss>"""
    (entry,) = valid_entries(feed, "https://blog.example.test/rss")
    assert entry.link == "https://blog.example.test/p"
    # The guid keys the item, so it stays the link as published (Q-P1-08).
    assert (
        entry.guid == "https://blog.example.test/p?utm_source=rss&utm_medium=feed#more"
    )


def test_an_entry_with_a_malformed_link_is_skipped_not_fatal() -> None:
    feed = b"""<rss version="2.0"><channel><title>t</title>
<item><title>Bad</title><link>https://blog.example.test:99999/p</link></item>
<item><title>Good</title><link>https://blog.example.test/ok</link></item>
</channel></rss>"""
    entries = valid_entries(feed, "https://blog.example.test/rss")
    assert [e.title for e in entries] == ["Good"]
