from __future__ import annotations

from collections import deque

MAX_CAPACITY = 1_000


class WorkQueue:
    """A FIFO queue with stated contracts. Class invariant, true after every call: it
    holds at most `capacity` items."""

    def __init__(self, capacity: int) -> None:
        # Precondition: a capacity from 1 to 10^3.
        if not 1 <= capacity <= MAX_CAPACITY:
            raise ValueError("capacity is from 1 to 10^3")
        self._capacity = capacity
        self._items: deque[str] = deque()

    def _invariant(self) -> None:
        assert len(self._items) <= self._capacity, "never more items than capacity"

    def offer(self, item: str) -> bool:
        # Precondition: a non-empty item. Postcondition: true with the item at the back,
        # or false with nothing changed when the queue is full.
        if item == "":
            raise ValueError("an item is not empty")
        if len(self._items) == self._capacity:
            return False
        self._items.append(item)
        self._invariant()
        return True

    def take(self) -> str:
        # Precondition: the queue isn't empty. Postcondition: the oldest item, removed.
        if not self._items:
            raise IndexError("the queue is empty")
        return self._items.popleft()

    def peekNext(self) -> str | None:
        # No precondition, and it never changes anything.
        return self._items[0] if self._items else None

    def size(self) -> int:
        return len(self._items)
