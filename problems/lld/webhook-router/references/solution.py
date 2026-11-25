from __future__ import annotations

from typing import NamedTuple, Protocol


class Matcher(Protocol):
    def matches(self, event: str) -> bool: ...


class Exact:
    def __init__(self, name: str) -> None:
        self._name = name

    def matches(self, event: str) -> bool:
        return event == self._name


class Prefix:
    def __init__(self, prefix: str) -> None:
        self._prefix = prefix

    def matches(self, event: str) -> bool:
        return event.startswith(self._prefix)


class Anything:
    def matches(self, event: str) -> bool:
        return True


# Each kind of matcher recognises its own patterns. A new kind is a new entry here and a
# new class; the router and the existing kinds never change.
def _exact(pattern: str) -> Matcher | None:
    return Exact(pattern) if "*" not in pattern else None


def _prefix(pattern: str) -> Matcher | None:
    stem = pattern[:-2]
    if pattern.endswith(".*") and stem != "" and "*" not in stem:
        return Prefix(stem + ".")
    return None


def _anything(pattern: str) -> Matcher | None:
    return Anything() if pattern == "*" else None


KINDS = (_exact, _prefix, _anything)


def matcher(pattern: str) -> Matcher:
    for kind in KINDS:
        found = kind(pattern)
        if found is not None:
            return found
    raise ValueError("not a pattern")


class Route(NamedTuple):
    pattern: str
    handler: str
    matcher: Matcher


def _named(text: str) -> str:
    if text == "":
        raise ValueError("an empty name")
    return text


class WebhookRouter:
    def __init__(self) -> None:
        self._routes: list[Route] = []
        self._exclusions: dict[str, dict[str, Matcher]] = {}

    def route(self, pattern: str, handler: str) -> None:
        found = matcher(_named(pattern))
        _named(handler)
        if not any(r.pattern == pattern and r.handler == handler for r in self._routes):
            self._routes.append(Route(pattern, handler, found))

    def deliver(self, event: str) -> list[str]:
        if "*" in _named(event):
            raise ValueError("an event has no wildcard")
        handlers: list[str] = []
        for route in self._routes:
            if (
                route.handler not in handlers
                and route.matcher.matches(event)
                and not self._excluded(route.handler, event)
            ):
                handlers.append(route.handler)
        return handlers

    def unroute(self, handler: str) -> int:
        _named(handler)
        kept = [r for r in self._routes if r.handler != handler]
        removed = len(self._routes) - len(kept)
        self._routes = kept
        self._exclusions.pop(handler, None)
        return removed

    # The extension round: a negative matcher is any matcher, used to skip a handler.
    def exclude(self, handler: str, pattern: str) -> None:
        found = matcher(_named(pattern))
        self._exclusions.setdefault(_named(handler), {}).setdefault(pattern, found)

    def _excluded(self, handler: str, event: str) -> bool:
        return any(m.matches(event) for m in self._exclusions.get(handler, {}).values())
