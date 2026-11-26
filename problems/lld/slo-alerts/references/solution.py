from __future__ import annotations

PERMILLE = 1000
PERCENT = 100


class Watcher:
    """An observer of one service. It speaks only when the service's burn crosses its
    threshold, in either direction, so it never repeats itself."""

    def __init__(self, subscriber: str, threshold: int) -> None:
        self.subscriber = subscriber
        self.threshold = threshold
        self.alerting = False

    def update(self, burned: int) -> str | None:
        burning = burned >= self.threshold
        if burning == self.alerting:
            return None
        self.alerting = burning
        return self.subscriber + (" burning" if burning else " recovered")


class Service:
    """The subject: its request counts, and the watchers it tells after each change."""

    def __init__(self) -> None:
        self.good = 0
        self.bad = 0
        self.watchers: dict[str, Watcher] = {}

    def burned(self, allowed: int) -> int:
        total = self.good + self.bad
        if total == 0:
            return 0
        return self.bad * PERMILLE * PERCENT // (total * allowed)


class SloMonitor:
    def __init__(self, objectivePermille: int) -> None:
        if not 0 < objectivePermille < PERMILLE:
            raise ValueError("an objective from 1 to 999 permille")
        # The error budget: how many requests in a thousand may fail.
        self._allowed = PERMILLE - objectivePermille
        self._services: dict[str, Service] = {}

    def _service(self, name: str) -> Service:
        if name == "":
            raise ValueError("an empty service")
        return self._services.setdefault(name, Service())

    def watch(self, subscriber: str, service: str, burnPercent: int) -> None:
        if subscriber == "" or service == "" or not 0 < burnPercent <= PERCENT:
            raise ValueError("an empty name or a threshold outside 1 to 100")
        watchers = self._service(service).watchers
        if subscriber in watchers:
            watchers[subscriber].threshold = burnPercent
        else:
            watchers[subscriber] = Watcher(subscriber, burnPercent)

    def observe(self, service: str, good: int, bad: int) -> list[str]:
        if service == "" or good < 0 or bad < 0:
            raise ValueError("an empty service or a negative count")
        subject = self._service(service)
        subject.good += good
        subject.bad += bad
        burned = subject.burned(self._allowed)
        told = [watcher.update(burned) for watcher in subject.watchers.values()]
        return [message for message in told if message is not None]

    def budgetLeft(self, service: str) -> int:
        if service == "":
            raise ValueError("an empty service")
        found = self._services.get(service)
        return PERCENT - (0 if found is None else found.burned(self._allowed))

    # The extension round: a watcher leaves, and coming back starts afresh at the end.
    def unwatch(self, subscriber: str, service: str) -> bool:
        if subscriber == "" or service == "":
            raise ValueError("an empty name")
        found = self._services.get(service)
        return found is not None and found.watchers.pop(subscriber, None) is not None
