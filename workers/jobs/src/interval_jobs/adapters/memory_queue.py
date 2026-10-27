"""In-memory queue for tests (ADR-0012), with the same delivery rules as the engines."""

from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass
from threading import Event

from interval_db.messages import MessageName
from interval_jobs.ports import Delivery, QueueHandler
from interval_jobs.queue import ATTEMPTS, parse, prepare


@dataclass
class _Pending:
    key: str
    payload: dict[str, object]
    attempts: int = 0
    delay_seconds: int = 0


class InMemoryQueue:
    def __init__(self) -> None:
        self._pending: defaultdict[str, list[_Pending]] = defaultdict(list)
        self._failed: defaultdict[str, list[dict[str, object]]] = defaultdict(list)

    def enqueue(
        self,
        name: MessageName,
        message: Mapping[str, object],
        idempotency_key: str,
        delay_seconds: int = 0,
    ) -> None:
        payload = prepare(name, message, idempotency_key, delay_seconds)
        # No dedupe: like SQS, the weaker engine, so handlers are tested against it.
        self._pending[name].append(
            _Pending(idempotency_key, payload, delay_seconds=delay_seconds)
        )

    def consume(self, name: MessageName, handler: QueueHandler, stop: Event) -> None:
        """Delivers until nothing is pending (retries included); delays are ignored."""
        queue = self._pending[name]
        while queue and not stop.is_set():
            pending = queue.pop(0)
            pending.attempts += 1
            try:
                handler(
                    parse(name, pending.payload),
                    Delivery(pending.attempts, pending.key),
                )
            except Exception:  # the handler's failure is the retry signal
                if pending.attempts >= ATTEMPTS:
                    self._failed[name].append(pending.payload)
                else:
                    queue.append(pending)

    def consume_one(
        self, name: MessageName, handler: QueueHandler, stop: Event
    ) -> None:
        """Tests: delivers only the first waiting message (a retry goes to the back)."""
        queue = self._pending[name]
        if not queue or stop.is_set():
            return
        pending = queue.pop(0)
        pending.attempts += 1
        try:
            handler(
                parse(name, pending.payload), Delivery(pending.attempts, pending.key)
            )
        except Exception:  # the handler's failure is the retry signal
            if pending.attempts >= ATTEMPTS:
                self._failed[name].append(pending.payload)
            else:
                queue.append(pending)

    def drop_pending(self, name: MessageName) -> None:
        """Tests: as if those deliveries had all ended in the failed store."""
        self._pending[name].clear()

    def pending(self, name: MessageName) -> int:
        return len(self._pending[name])

    def pending_messages(
        self, name: MessageName
    ) -> list[tuple[str, dict[str, object]]]:
        """Tests: what is waiting, as (idempotency key, message)."""
        return [(p.key, p.payload) for p in self._pending[name]]

    def pending_delays(self, name: MessageName) -> list[int]:
        """Tests: each waiting message's delay, which delivery here ignores."""
        return [p.delay_seconds for p in self._pending[name]]

    def failed_messages(self, name: MessageName) -> list[dict[str, object]]:
        return list(self._failed[name])
