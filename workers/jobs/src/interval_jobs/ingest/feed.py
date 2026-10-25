"""Parse a fetched RSS or Atom feed into its newest valid entry (ING-1 discover)."""

import calendar
import io
from datetime import UTC, datetime
from html.parser import HTMLParser
from time import struct_time
from typing import Any
from urllib.parse import urljoin, urlsplit

import feedparser
from pydantic import BaseModel, ConfigDict

from interval_jobs import log
from interval_jobs.rights import EXCERPT_MAX_CHARS


class NoValidEntryError(Exception):
    pass


class FeedEntry(BaseModel):
    model_config = ConfigDict(frozen=True)

    guid: str
    link: str
    title: str
    author: str | None
    published_at: datetime | None
    updated_at: datetime | None
    summary: str | None


class _TextOnly(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def plain_summary(html: str) -> str | None:
    """Plain text, capped like an excerpt (owner, 2026-10-25)."""
    parser = _TextOnly()
    parser.feed(html)
    parser.close()
    text = " ".join(" ".join(parser.parts).split())
    return text[:EXCERPT_MAX_CHARS] or None


def _text(entry: dict[str, Any], key: str) -> str | None:
    value = entry.get(key)
    return (value.strip() or None) if isinstance(value, str) else None


def _time(entry: dict[str, Any], key: str) -> datetime | None:
    # dict.get, not entry.get: FeedParserDict.get maps a missing `published_parsed`
    # to `updated_parsed`, which would make an edited old post look newly published.
    value = dict[str, Any].get(entry, key)
    if isinstance(value, struct_time):
        return datetime.fromtimestamp(calendar.timegm(value), tz=UTC)
    return None


def _summary(raw: dict[str, Any]) -> str | None:
    summary = _text(raw, "summary")
    if summary is None:
        return None
    # feedparser copies content:encoded / Atom <content> into `summary` when the entry
    # has no summary of its own; that is the full post and must not be stored (Q-P1-01).
    contents: list[dict[str, Any]] = raw.get("content") or []
    if any(summary == (c.get("value") or "").strip() for c in contents):
        return None
    return plain_summary(summary)


def _to_entry(raw: dict[str, Any], feed_url: str) -> FeedEntry | None:
    link = _text(raw, "link")
    title = _text(raw, "title")
    if link is None or title is None:
        return None
    absolute = urljoin(feed_url, link)
    if urlsplit(absolute).scheme not in ("http", "https"):
        return None
    return FeedEntry(
        guid=_text(raw, "id") or absolute,
        link=absolute,
        title=title,
        author=_text(raw, "author"),
        published_at=_time(raw, "published_parsed"),
        updated_at=_time(raw, "updated_parsed"),
        summary=_summary(raw),
    )


def newest_entry(feed: bytes, feed_url: str) -> FeedEntry:
    # A file object, never bytes or str: feedparser opens those as a path or URL.
    raw_entries = feedparser.parse(io.BytesIO(feed)).entries
    entries: list[FeedEntry] = []
    for index, raw in enumerate(raw_entries):
        entry = _to_entry(raw, feed_url)
        if entry is None:
            log.warn("feed: skipped invalid entry", feed_url=feed_url, index=index)
        else:
            entries.append(entry)
    if not entries:
        raise NoValidEntryError(f"feed {feed_url} has no valid entry")

    # Newest by publication date; `updated` only when no entry has one, since an edit
    # to an old post would otherwise make it "newest".
    for key in ("published_at", "updated_at"):
        dated = [(getattr(e, key), e) for e in entries if getattr(e, key) is not None]
        if dated:
            return max(dated, key=lambda pair: pair[0])[1]
    return entries[0]
