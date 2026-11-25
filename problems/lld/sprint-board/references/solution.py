from __future__ import annotations

from enum import IntEnum


# The columns, in board order: a ticket moves only to a neighbour.
class Column(IntEnum):
    TODO = 0
    DOING = 1
    REVIEW = 2
    DONE = 3


# Names are matched exactly: "Doing" is not a column.
BY_NAME = {c.name.lower(): c for c in Column}


class Ticket:
    def __init__(self, points: int) -> None:
        self.points = points
        self.column = Column.TODO
        self.reason: str | None = None


class SprintBoard:
    def __init__(self, wipLimit: int) -> None:
        if not 1 <= wipLimit <= 100:
            raise ValueError("wipLimit must be within 1-100")
        self._limit = wipLimit
        self._tickets: dict[str, Ticket] = {}

    def _ticket(self, ticket: str) -> Ticket:
        if ticket not in self._tickets:
            raise KeyError("no such ticket")
        return self._tickets[ticket]

    def _in(self, column: Column) -> list[Ticket]:
        return [t for t in self._tickets.values() if t.column == column]

    def add(self, title: str, points: int) -> str:
        if title == "" or not 1 <= points <= 100:
            raise ValueError("a ticket needs a title and 1-100 points")
        ticket = f"T-{len(self._tickets) + 1}"
        self._tickets[ticket] = Ticket(points)
        return ticket

    def move(self, ticket: str, column: str) -> bool:
        t = self._ticket(ticket)
        if column not in BY_NAME:
            raise ValueError("no such column")
        to = BY_NAME[column]
        if abs(to - t.column) != 1 or t.reason is not None:
            return False
        if to == Column.DOING and len(self._in(Column.DOING)) >= self._limit:
            return False
        t.column = to
        return True

    def column(self, ticket: str) -> str:
        return self._ticket(ticket).column.name.lower()

    def velocity(self) -> int:
        return sum(t.points for t in self._in(Column.DONE))

    # The extension round.
    def block(self, ticket: str, reason: str) -> None:
        t = self._ticket(ticket)
        if reason == "":
            raise ValueError("a block needs a reason")
        t.reason = reason

    def unblock(self, ticket: str) -> None:
        self._ticket(ticket).reason = None

    def blocked(self) -> list[str]:
        return [f"{k}: {t.reason}" for k, t in self._tickets.items() if t.reason is not None]
