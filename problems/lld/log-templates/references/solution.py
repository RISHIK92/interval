from __future__ import annotations

HOLE = "{}"


class Template:
    """The flyweight: a message pattern split once into its literal parts. It holds
    nothing about any one event, so every event with this pattern shares it."""

    def __init__(self, pattern: str) -> None:
        self.parts = pattern.split(HOLE)

    def holes(self) -> int:
        return len(self.parts) - 1

    def render(self, params: list[str]) -> str:
        out = self.parts[0]
        for i, param in enumerate(params):
            out += param + self.parts[i + 1]
        return out


class LogStore:
    """Events keep only their own parameters and a reference to their template."""

    def __init__(self) -> None:
        self._templates: dict[str, Template] = {}
        self._events: dict[int, tuple[Template, list[str]]] = {}
        self._ids: dict[str, list[int]] = {}
        self._last = 0

    def log(self, pattern: str, params: list[str]) -> int:
        if pattern == "" or "" in params:
            raise ValueError("an empty pattern or parameter")
        template = self._templates.get(pattern) or Template(pattern)
        if template.holes() != len(params):
            raise ValueError("one parameter per {}")
        self._templates[pattern] = template
        self._last += 1
        self._events[self._last] = (template, list(params))
        self._ids.setdefault(pattern, []).append(self._last)
        return self._last

    def render(self, eventId: int) -> str:
        if eventId not in self._events:
            raise KeyError("unknown event")
        template, params = self._events[eventId]
        return template.render(params)

    def templates(self) -> int:
        return len(self._templates)

    def byPattern(self, pattern: str) -> list[int]:
        if pattern == "":
            raise ValueError("an empty pattern")
        return list(self._ids.get(pattern, []))

    # The extension round: a pattern goes, and with it every event that shared it.
    def purge(self, pattern: str) -> int:
        if pattern == "":
            raise ValueError("an empty pattern")
        self._templates.pop(pattern, None)
        ids = self._ids.pop(pattern, [])
        for event in ids:
            del self._events[event]
        return len(ids)
