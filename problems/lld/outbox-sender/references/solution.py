from __future__ import annotations

from abc import ABC, abstractmethod


class Transport(ABC):
    """The abstraction the sender depends on. A transport delivers one message and returns
    its receipt, or None when the send failed; how it delivers is its own business."""

    def __init__(self) -> None:
        self._failures = 0

    def send(self, id: str, payload: str) -> str | None:
        if self._failures:
            self._failures -= 1
            return None
        return self.deliver(id, payload)

    def plan_failures(self, n: int) -> None:
        self._failures = n

    @abstractmethod
    def deliver(self, id: str, payload: str) -> str: ...


class Http(Transport):
    def deliver(self, id: str, payload: str) -> str:
        return f"POST {id} {payload}"


class Queue(Transport):
    def deliver(self, id: str, payload: str) -> str:
        return f"PUBLISH {id} {payload}"


class Email(Transport):
    def deliver(self, id: str, payload: str) -> str:
        return f"MAIL {id} {payload}"


TRANSPORTS: dict[str, type[Transport]] = {"http": Http, "queue": Queue, "email": Email}


def _transport(name: str) -> Transport:
    made = TRANSPORTS.get(name)
    if made is None:
        raise ValueError("unknown transport")
    return made()


def _given(value: str) -> None:
    if value == "":
        raise ValueError("empty")


class Message:
    def __init__(self, id: str, payload: str) -> None:
        self.id = id
        self.payload = payload
        self.failed = 0


class OutboxSender:
    """Business code only ever writes to the outbox. Which transport delivers is chosen by
    name from a registry, and can be replaced while messages wait, without the outbox changing."""

    def __init__(self, transport: str) -> None:
        self._name = transport
        self._transport = _transport(transport)
        self._pending: list[Message] = []
        self._seen: set[str] = set()
        self._limit: int | None = None
        self._dead: list[str] = []

    def enqueue(self, id: str, payload: str) -> bool:
        _given(id)
        _given(payload)
        if id in self._seen:
            return False
        self._seen.add(id)
        self._pending.append(Message(id, payload))
        return True

    def flush(self) -> list[str]:
        receipts: list[str] = []
        waiting: list[Message] = []
        for message in self._pending:
            receipt = self._transport.send(message.id, message.payload)
            if receipt is not None:
                receipts.append(receipt)
                continue
            message.failed += 1
            if self._limit is not None and message.failed >= self._limit:
                self._dead.append(message.id)
            else:
                waiting.append(message)
        self._pending = waiting
        return receipts

    def failNext(self, n: int) -> None:
        if n < 0:
            raise ValueError("negative count")
        self._transport.plan_failures(n)

    def swapTransport(self, transport: str) -> None:
        if transport == self._name:
            raise ValueError("already in use")
        self._transport = _transport(transport)
        self._name = transport

    def pending(self) -> int:
        return len(self._pending)

    # The extension round: a limit on retries, and somewhere for the hopeless to go.
    def maxAttempts(self, n: int) -> None:
        if n < 1:
            raise ValueError("at least one attempt")
        self._limit = n

    def deadLetters(self) -> list[str]:
        return list(self._dead)
