from __future__ import annotations

ADVANCE_BELOW = 1.0
ABORT_ABOVE = 5.0
MAX_RATE = 100.0


class State:
    """One state of the rollout. Each move returns the next state, or None when this
    state doesn't allow it, so every state lists only its own moves."""

    name: str
    percent = 0

    def begin(self) -> State | None:
        return None

    def advance(self) -> State | None:
        return None

    def pause(self) -> State | None:
        return None

    def resume(self) -> State | None:
        return None

    def abort(self) -> State | None:
        return None


class Done(State):
    name = "done"
    percent = 100


class RolledBack(State):
    name = "rolled-back"


class Paused(State):
    name = "paused"

    def __init__(self, was: State) -> None:
        self.was = was
        self.percent = was.percent

    def resume(self) -> State | None:
        return self.was


class Moving(State):
    """Canary and rolling share their moves: on, pause and abort."""

    def __init__(self, name: str, percent: int, after: State) -> None:
        self.name = name
        self.percent = percent
        self.after = after

    def advance(self) -> State | None:
        return self.after

    def pause(self) -> State | None:
        return Paused(self)

    def abort(self) -> State | None:
        return RolledBack()


class Pending(State):
    name = "pending"

    def begin(self) -> State | None:
        return Moving("canary", 10, Moving("rolling", 50, Done()))


class Rollout:
    def __init__(self, service: str) -> None:
        if service == "":
            raise ValueError("an empty service")
        self._service = service
        self._version = ""
        self._state: State = Pending()

    def _move(self, to: State | None) -> bool:
        if to is None:
            return False
        self._state = to
        return True

    def begin(self, version: str) -> bool:
        if version == "":
            raise ValueError("an empty version")
        to = self._state.begin()
        if to is not None:
            self._version = version
        return self._move(to)

    def advance(self) -> bool:
        return self._move(self._state.advance())

    def pause(self) -> bool:
        return self._move(self._state.pause())

    def resume(self) -> bool:
        return self._move(self._state.resume())

    def abort(self) -> bool:
        return self._move(self._state.abort())

    def status(self) -> str:
        if self._version == "":
            return f"{self._service} {self._state.name}"
        return f"{self._service} {self._state.name} {self._version} {self._state.percent}%"

    # The extension round: the error rate decides the move.
    def autoAdvance(self, errorRate: float) -> bool:
        if not 0 <= errorRate <= MAX_RATE:
            raise ValueError("an error rate from 0 to 100")
        if errorRate < ADVANCE_BELOW:
            return self.advance()
        if errorRate > ABORT_ABOVE:
            return self.abort()
        return False
