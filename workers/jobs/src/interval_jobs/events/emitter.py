"""Event emission (DB-5, Q-P1-20): the worker's side of the web app's emitter.

Same rules (owner, 2026-10-25): buffer, write at 100 events or on flush, retry rejected
records once, then drop them and log "events: emit failed" with a count, which the AWS
stack turns into a metric. Emitting never raises: analytics must not fail a job.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

from pydantic import TypeAdapter, ValidationError

from interval_jobs import log
from interval_jobs.events.generated import (
    EVENT_VERSIONS,
    BetaGroup,
    Envelope,
    EventName,
)
from interval_jobs.ports import EventSink

_ENVELOPE = TypeAdapter[Envelope](Envelope)


@dataclass(frozen=True)
class EventContext:
    user_id: str
    is_guest: bool
    beta_group: BetaGroup
    session_id: str | None


class Emitter:
    def __init__(self, sink: EventSink, max_batch: int = 100) -> None:
        self._sink = sink
        self._max_batch = max_batch
        self._buffer: list[Envelope] = []

    def emit(
        self, name: EventName, props: Mapping[str, object], context: EventContext
    ) -> None:
        now = datetime.now(UTC)
        # Milliseconds, like the web app: the event in memory equals what is written.
        occurred_at = now.replace(microsecond=now.microsecond // 1000 * 1000)
        try:
            event = _ENVELOPE.validate_python(
                {
                    "event_id": uuid4(),
                    "name": name,
                    "version": EVENT_VERSIONS[name],
                    "occurred_at": occurred_at,
                    "user_id": context.user_id,
                    "is_guest": context.is_guest,
                    "beta_group": context.beta_group,
                    "session_id": context.session_id,
                    "source": "jobs",
                    "props": dict(props),
                }
            )
        except ValidationError as error:
            log.error(
                "events: emit failed",
                count=1,
                names=[name],
                reason="invalid",
                issues=[".".join(map(str, e["loc"])) for e in error.errors()],
            )
            return
        self._buffer.append(event)
        if len(self._buffer) >= self._max_batch:
            self.flush()

    def flush(self) -> None:
        batch, self._buffer = self._buffer, []
        if not batch:
            return
        failed = self._write(batch)
        if failed:
            failed = self._write(failed)
        if failed:
            log.error(
                "events: emit failed",
                count=len(failed),
                names=sorted({e.name for e in failed}),
                reason="undelivered",
            )

    def _write(self, batch: list[Envelope]) -> list[Envelope]:
        try:
            return self._sink.write(batch)
        # Any sink failure means "not delivered"; emitting never raises.
        except Exception as error:
            log.warn("events: sink write failed", count=len(batch), error=error)
            return batch
