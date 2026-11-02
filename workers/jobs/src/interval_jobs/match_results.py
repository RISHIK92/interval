"""Live match results (P3-W15-S05, ADR-0033): the game server leaves each result in
Valkey (game:result:<id>) and pushes its id onto game:results; the relay here moves
ids onto the normal queue (match_finished, ADR-0010), and the stage records each result
once.

The result's shape mirrors services/game/match.go's `result`; both sides test against
services/game/testdata/match_finished.json. The queue message itself is codegen's
(packages/db/messages/match_finished.schema.json): the result's nesting is beyond it.
"""

import threading
from datetime import datetime
from typing import Literal, Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from interval_jobs import log
from interval_jobs.ports import JobQueue


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class MatchAnswer(_Strict):
    round: int = Field(ge=1, le=20)
    question_id: int = Field(ge=1)
    choice: int | None = Field(ge=0, le=3)
    correct: bool | None
    ms: int | None = Field(ge=0)


class PlayerResult(_Strict):
    played_as: str = Field(min_length=1)
    total: int = Field(ge=0)
    time_ms: int = Field(ge=0)
    abandoned: bool
    answers: list[MatchAnswer] = Field(max_length=20)


class MatchResult(_Strict):
    match_id: UUID
    finished_at: datetime
    outcome: Literal["finished", "abandoned", "cancelled", "void"]
    winner: str | None = Field(min_length=1)
    players: list[PlayerResult] = Field(min_length=1, max_length=8)


def parse_result(raw: bytes) -> MatchResult | None:
    """The result, or None (logged) when it isn't one: not retried, it won't change."""
    try:
        return MatchResult.model_validate_json(raw)
    except ValidationError as error:
        log.error("game: result refused", error=str(error))
        return None


class ResultsRedis(Protocol):
    """The calls the relay makes (redis-py)."""

    def blmove(
        self, first_list: str, second_list: str, timeout: int, src: str, dest: str
    ) -> bytes | None: ...
    def lrange(self, name: str, start: int, end: int) -> list[bytes]: ...
    def lrem(self, name: str, count: int, value: bytes) -> int: ...
    def lpush(self, name: str, *values: bytes) -> int: ...
    def get(self, name: str) -> bytes | None: ...


def _send(redis: ResultsRedis, queue: JobQueue, raw: bytes, prefix: str) -> None:
    working = f"{prefix}results:working"
    try:
        match_id = str(UUID(raw.decode()))
    except (ValueError, UnicodeDecodeError):
        log.error("game: result refused", reason="not a match id")
        redis.lpush(f"{prefix}results:refused", raw)
        redis.lrem(working, 1, raw)
        return
    queue.enqueue("match_finished", {"match_id": match_id}, f"match-{match_id}")
    redis.lrem(working, 1, raw)


def relay(
    redis: ResultsRedis,
    queue: JobQueue,
    stop: threading.Event,
    prefix: str = "game:",
    wait_seconds: int = 1,
) -> None:
    """Moves match ids from game:results to the queue until stopped. Each id is moved to
    a working list first and leaves it only once queued, so a crash re-sends it on the
    next start; the queue's key and the stage's once-only write absorb a repeat."""
    working = f"{prefix}results:working"
    resent = False
    while not stop.is_set():
        try:
            # Several workers each re-send the working list at start, including ids
            # another is still sending; the queue's key and the once-only write
            # absorb that.
            if not resent:
                for raw in redis.lrange(working, 0, -1):
                    _send(redis, queue, raw, prefix)
                resent = True
            raw = redis.blmove(
                f"{prefix}results", working, wait_seconds, "RIGHT", "LEFT"
            )
            if raw is not None:
                _send(redis, queue, raw, prefix)
        except OSError as error:  # ConnectionError, TimeoutError: the adapter's
            # Valkey away for a moment (a restart, a failover): the ids wait in it;
            # say so and try again, rather than stopping every stage.
            log.warn("game: result relay waiting for valkey", error=str(error))
            stop.wait(5)
