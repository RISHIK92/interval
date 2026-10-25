# Minimal stub for feedparser 6 (ships no types): only the surface workers/jobs uses.
# `parse` takes a file object only: feedparser opens bytes/str as a local path or URL.
from typing import IO, Any

class FeedParserDict(dict[str, Any]):
    entries: list[dict[str, Any]]

def parse(url_file_stream_or_string: IO[bytes]) -> FeedParserDict: ...
