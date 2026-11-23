"""LLD practice progress (ADR-0048, Q-WD-28): after each judged Submit the game server
pushes the player's counts onto game:practice (services/game/battle_actor.go's
practiceJudged); the relay here checks each and queues it as practice_judged
(ADR-0010), and the stage keeps the player's best, once per match and sequence number
(LOAD-5).

Both sides test against services/game/testdata/practice_judged.json. The queue message
is codegen's (packages/db/messages/practice_judged.schema.json), so the layers are
flattened here.
"""

import threading
from datetime import datetime
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from interval_jobs import log
from interval_jobs.match_results import ResultsRedis, relay_list
from interval_jobs.ports import JobQueue

LAYERS = ("visible", "hidden", "concurrency", "extension")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class LayerCount(_Strict):
    passed: int = Field(ge=0)
    total: int = Field(ge=0)

    @model_validator(mode="after")
    def _passed_within_total(self) -> Self:
        if self.passed > self.total:
            raise ValueError("more passed than run")
        return self


class PracticeProgress(_Strict):
    """The game server's message: per-layer counts only (LLDQ-4), never code."""

    match_id: str = Field(pattern=r"^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$")
    seq: int = Field(ge=1)
    user: str = Field(min_length=1)
    problem: str = Field(min_length=1, max_length=48)
    points: int = Field(ge=0, le=1000)
    layers: dict[Literal["visible", "hidden", "concurrency", "extension"], LayerCount]
    language: str = Field(min_length=1, max_length=20)
    at: datetime


def judged_message(raw: bytes) -> dict[str, object] | None:
    """The practice_judged message for the game server's progress, or None (logged)
    when it isn't one: not retried, it won't change."""
    try:
        progress = PracticeProgress.model_validate_json(raw)
    except ValidationError as error:
        log.error("game: practice progress refused", error=str(error))
        return None
    message: dict[str, object] = {
        "match_id": progress.match_id,
        "seq": progress.seq,
        "played_as": progress.user,
        "problem_slug": progress.problem,
        "points": progress.points,
        # The extension's layer is judged only once the player revealed it.
        "extension_revealed": "extension" in progress.layers,
        "language": progress.language,
        "judged_at": progress.at.isoformat(),
    }
    for layer in LAYERS:
        count = progress.layers.get(layer, LayerCount(passed=0, total=0))
        message[f"{layer}_passed"] = count.passed
        message[f"{layer}_total"] = count.total
    return message


def relay_practice(
    redis: ResultsRedis,
    queue: JobQueue,
    stop: threading.Event,
    prefix: str = "game:",
    wait_seconds: int = 1,
) -> None:
    """Moves practice progress from game:practice to the queue until stopped."""
    working = f"{prefix}practice:working"

    def send(raw: bytes) -> None:
        message = judged_message(raw)
        if message is None:
            redis.lpush(f"{prefix}practice:refused", raw)
        else:
            queue.enqueue(
                "practice_judged",
                message,
                f"practice-{message['match_id']}-{message['seq']}",
            )
        redis.lrem(working, 1, raw)

    relay_list(redis, stop, f"{prefix}practice", send, wait_seconds)
