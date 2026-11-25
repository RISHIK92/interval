from __future__ import annotations

from enum import Enum


class State(Enum):
    IDLE = "idle"
    OPEN = "open"
    CLOSED = "closed"
    FAILED = "failed"


# Every legal move: (action, from) -> to. Anything else is refused.
MOVES: dict[tuple[str, State], State] = {
    ("connect", State.IDLE): State.OPEN,
    ("disconnect", State.OPEN): State.CLOSED,
    ("fail", State.IDLE): State.FAILED,
    ("fail", State.OPEN): State.FAILED,
    ("reconnect", State.FAILED): State.OPEN,
}


class Connection:
    def __init__(self, host: str) -> None:
        if host == "":
            raise ValueError("a connection needs a host")
        self._host = host
        self._state = State.IDLE
        self._reopened = 0

    def _move(self, action: str) -> bool:
        to = MOVES.get((action, self._state))
        if to is None:
            return False
        self._state = to
        return True

    def connect(self) -> bool:
        return self._move("connect")

    def disconnect(self) -> bool:
        return self._move("disconnect")

    def fail(self, reason: str) -> None:
        if reason == "":
            raise ValueError("a failure needs a reason")
        self._move("fail")

    def state(self) -> str:
        return self._state.value

    # The extension round.
    def reconnect(self) -> bool:
        moved = self._move("reconnect")
        if moved:
            self._reopened += 1
        return moved

    def attempts(self) -> int:
        return self._reopened
