from __future__ import annotations

from collections.abc import Callable
from functools import cmp_to_key

Row = dict[str, str]
SOURCE = "logs"
MAX_TOP = 10_000
MAX_DIGITS = 9
NAME_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.")
OPS: dict[str, Callable[[int], bool]] = {
    "=": lambda c: c == 0,
    "!=": lambda c: c != 0,
    "<": lambda c: c < 0,
    "<=": lambda c: c <= 0,
    ">": lambda c: c > 0,
    ">=": lambda c: c >= 0,
}


def _name(text: str) -> str:
    if text == "" or any(c not in NAME_CHARS for c in text):
        raise ValueError("a name is letters, digits, _ and .")
    return text


def _integer(text: str) -> int | None:
    digits = text[1:] if text.startswith("-") else text
    if len(digits) <= MAX_DIGITS and _digits(digits):
        return int(text)
    return None


def _digits(text: str) -> bool:
    return text.isascii() and text.isdigit()


def _words(text: str) -> list[str]:
    return [w for w in text.split(" ") if w]


def compare(a: str, b: str) -> int:
    """One order for every stage: integers by value, before every other value, and
    other values by character code."""
    x, y = _integer(a), _integer(b)
    if x is not None and y is not None:
        return (x > y) - (x < y)
    if x is not None or y is not None:
        return (x is None) - (y is None)
    return (a > b) - (a < b)


class Where:
    def __init__(self, field: str, op: str, value: str) -> None:
        self.field = field
        self.op = op
        self.value = value

    def apply(self, rows: list[Row]) -> list[Row]:
        test = OPS[self.op]
        return [
            r
            for r in rows
            if self.field in r and test(compare(r[self.field], self.value))
        ]

    def accept(self, visitor: Explainer) -> str:
        return visitor.where(self)


class Count:
    def __init__(self, field: str) -> None:
        self.field = field

    def apply(self, rows: list[Row]) -> list[Row]:
        counts: dict[str, int] = {}
        for r in rows:
            if self.field in r:
                counts[r[self.field]] = counts.get(r[self.field], 0) + 1
        return [{self.field: v, "count": str(n)} for v, n in counts.items()]

    def accept(self, visitor: Explainer) -> str:
        return visitor.count(self)


class Sort:
    def __init__(self, field: str, descending: bool) -> None:
        self.field = field
        self.descending = descending

    def apply(self, rows: list[Row]) -> list[Row]:
        key = cmp_to_key(lambda a, b: compare(a[self.field], b[self.field]))
        # Stable, reversed or not: equal rows keep their order.
        having = sorted(
            (r for r in rows if self.field in r), key=key, reverse=self.descending
        )
        return having + [r for r in rows if self.field not in r]

    def accept(self, visitor: Explainer) -> str:
        return visitor.sort(self)


class Top:
    def __init__(self, n: int) -> None:
        self.n = n

    def apply(self, rows: list[Row]) -> list[Row]:
        return rows[: self.n]

    def accept(self, visitor: Explainer) -> str:
        return visitor.top(self)


Stage = Where | Count | Sort | Top


class Explainer:
    """A visitor: one line per stage, in a canonical spelling."""

    def where(self, s: Where) -> str:
        return f"where {s.field} {s.op} {s.value}"

    def count(self, s: Count) -> str:
        return f"count {s.field}"

    def sort(self, s: Sort) -> str:
        return f"sort {s.field} {'desc' if s.descending else 'asc'}"

    def top(self, s: Top) -> str:
        return f"top {s.n}"


class Pipeline:
    """The parsed query: a source and its stages."""

    def __init__(self, source: str, stages: list[Stage]) -> None:
        self.source = source
        self.stages = stages


def _stage(words: list[str]) -> Stage:
    kind, n = words[0], len(words)
    if kind == "where" and n == 4 and words[2] in OPS:
        return Where(_name(words[1]), words[2], words[3])
    if kind == "count" and n == 2 and words[1] != "count":
        return Count(_name(words[1]))
    if kind == "sort" and n == 2:
        return Sort(_name(words[1]), False)
    if kind == "sort" and n == 3 and words[2] in ("asc", "desc"):
        return Sort(_name(words[1]), words[2] == "desc")
    if kind == "top" and n == 2 and len(words[1]) <= 5 and _digits(words[1]):
        top = int(words[1])
        if 1 <= top <= MAX_TOP:
            return Top(top)
    raise ValueError("not a stage")


def parse(query: str) -> Pipeline:
    parts = [_words(part) for part in query.split("|")]
    if any(not words for words in parts):
        raise ValueError("an empty part")
    [source] = parts[0]  # fails unless the source is one word
    return Pipeline(source, [_stage(words) for words in parts[1:]])


class LogQuery:
    def __init__(self) -> None:
        self._records: list[Row] = []
        self._views: dict[str, Pipeline] = {}

    def ingest(self, fields: dict[str, str]) -> None:
        if not fields:
            raise ValueError("an empty record")
        for name, value in fields.items():
            _name(name)
            if value == "":
                raise ValueError("an empty value")
        self._records.append(dict(fields))

    def run(self, query: str) -> list[str]:
        rows = self._rows(self._checked(query))
        return [" ".join(f"{k}={r[k]}" for k in sorted(r)) for r in rows]

    def explainQuery(self, query: str) -> list[str]:
        return self._explain(self._checked(query))

    # The extension round: saved views, usable as sources.
    def saveView(self, name: str, query: str) -> None:
        _name(name)
        pipeline = self._checked(query)
        if name == SOURCE or name in self._views:
            raise ValueError("that source exists")
        self._views[name] = pipeline

    def _checked(self, query: str) -> Pipeline:
        pipeline = parse(query)
        if pipeline.source != SOURCE and pipeline.source not in self._views:
            raise KeyError("no such source")
        return pipeline

    def _rows(self, pipeline: Pipeline) -> list[Row]:
        view = self._views.get(pipeline.source)
        rows = self._records if view is None else self._rows(view)
        for stage in pipeline.stages:
            rows = stage.apply(rows)
        return rows

    def _explain(self, pipeline: Pipeline) -> list[str]:
        view = self._views.get(pipeline.source)
        lines = [f"source {SOURCE}"] if view is None else self._explain(view)
        explainer = Explainer()
        return lines + [stage.accept(explainer) for stage in pipeline.stages]
