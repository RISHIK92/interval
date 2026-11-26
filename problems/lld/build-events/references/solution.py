from __future__ import annotations

EVENTS = {"queued", "started", "passed", "failed"}


def _given(value: str) -> None:
    if value == "":
        raise ValueError("empty")


class Subscriber:
    """An observer: it takes delivery of the events it chose. While paused it keeps them
    back, in order, until it's resumed."""

    def __init__(self, name: str, events: list[str]) -> None:
        self.name = name
        self.events = set(events)
        self.inbox: list[str] = []
        self.kept: list[str] | None = None

    def update(self, delivery: str) -> bool:
        """Takes the delivery; whether it reached the inbox now (not kept back)."""
        if self.kept is not None:
            self.kept.append(delivery)
        else:
            self.inbox.append(delivery)
        return self.kept is None


class BuildEvents:
    """The subject: it updates every subscriber that chose the event, in the order they
    subscribed, and knows nothing else about them."""

    def __init__(self) -> None:
        self._subscribers: dict[str, Subscriber] = {}

    def subscribe(self, subscriber: str, events: list[str]) -> None:
        _given(subscriber)
        if not events or len(set(events)) != len(events):
            raise ValueError("no events, or one listed twice")
        for event in events:
            self._event(event)
        if subscriber in self._subscribers:
            raise ValueError("already subscribed")
        self._subscribers[subscriber] = Subscriber(subscriber, events)

    def unsubscribe(self, subscriber: str) -> bool:
        _given(subscriber)
        return self._subscribers.pop(subscriber, None) is not None

    def publish(self, event: str, build: str) -> list[str]:
        self._event(event)
        _given(build)
        delivered: list[str] = []
        for subscriber in self._subscribers.values():
            if event in subscriber.events:
                if subscriber.update(f"{build} {event}"):
                    delivered.append(subscriber.name)
        return delivered

    def inbox(self, subscriber: str) -> list[str]:
        return list(self._subscriber(subscriber).inbox)

    # The extension round: holding deliveries back.
    def pause(self, subscriber: str) -> None:
        found = self._subscriber(subscriber)
        if found.kept is not None:
            raise ValueError("already paused")
        found.kept = []

    def resume(self, subscriber: str) -> int:
        found = self._subscriber(subscriber)
        if found.kept is None:
            raise ValueError("not paused")
        found.inbox.extend(found.kept)
        delivered = len(found.kept)
        found.kept = None
        return delivered

    @staticmethod
    def _event(event: str) -> None:
        if event not in EVENTS:
            raise ValueError("unknown event")

    def _subscriber(self, subscriber: str) -> Subscriber:
        found = self._subscribers.get(subscriber)
        if found is None:
            raise ValueError("not subscribed")
        return found
