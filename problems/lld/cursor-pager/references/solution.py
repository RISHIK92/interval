from __future__ import annotations

from bisect import bisect_left, bisect_right, insort

MAX_PAGE_SIZE = 1000


def _item(item: str) -> None:
    if item == "":
        raise ValueError("empty item")


class Walk:
    """An iterator over the shared, sorted items. It remembers the last item it
    returned, not a position, so items inserted around it never make it skip or repeat
    one."""

    def __init__(self, items: list[str]) -> None:
        self._items = items
        self._last: str | None = None

    def _at(self) -> int:
        return 0 if self._last is None else bisect_right(self._items, self._last)

    def hasNext(self) -> bool:
        return self._at() < len(self._items)

    def next(self) -> str:
        if not self.hasNext():
            raise ValueError("no more items")
        self._last = self._items[self._at()]
        return self._last


class ResultPager:
    """A sorted result set, walked one item at a time or a page at a time. A page's
    cursor is the last item seen, so the next page starts after that item wherever it
    is now."""

    def __init__(self, items: list[str], pageSize: int) -> None:
        if not 1 <= pageSize <= MAX_PAGE_SIZE:
            raise ValueError("bad page size")
        for item in items:
            _item(item)
        self._items = sorted(items)
        if len(set(items)) != len(items):
            raise ValueError("an item listed twice")
        self._size = pageSize
        self._walk = Walk(self._items)

    def hasNext(self) -> bool:
        return self._walk.hasNext()

    def next(self) -> str:
        return self._walk.next()

    def page(self, cursor: str) -> list[str]:
        start = self._after(cursor)
        return self._items[start : start + self._size]

    def nextCursor(self, cursor: str) -> str | None:
        end = self._after(cursor) + self._size
        return self._items[end - 1] if end < len(self._items) else None

    # The extension round: the result set grows while it's being walked.
    def insertItem(self, item: str) -> None:
        _item(item)
        if self._has(item):
            raise ValueError("already there")
        insort(self._items, item)

    def _has(self, item: str) -> bool:
        at = bisect_left(self._items, item)
        return at < len(self._items) and self._items[at] == item

    def _after(self, cursor: str) -> int:
        """Where the page after the cursor starts: "" is the start of the results."""
        if cursor == "":
            return 0
        if not self._has(cursor):
            raise ValueError("unknown cursor")
        return bisect_right(self._items, cursor)
