from __future__ import annotations

import re

PLAIN = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
OPS = {"=", "<>", "<", "<=", ">", ">=", "LIKE"}
MAX_LIMIT = 1_000_000_000


def _name(identifier: str) -> str:
    # Identifiers go into the text, so only a plain name may: no quotes, spaces or dots.
    if PLAIN.fullmatch(identifier) is None:
        raise ValueError("not a plain name")
    return identifier


class QueryBuilder:
    """A builder: each call records one part of the query, and build() assembles them in
    SQL's order whatever order they came in. Values are only ever kept as parameters, so
    nothing a caller passes as a value can change the statement."""

    def __init__(self, table: str) -> None:
        self._table = _name(table)
        self._columns: list[str] = []
        self._conditions: list[str] = []
        self._values: list[str] = []
        self._order: list[str] = []
        self._ordered: set[str] = set()
        self._limit: int | None = None
        self._joins: list[str] = []
        self._joined = {table}

    def columns(self, cols: list[str]) -> None:
        if not cols or len(set(cols)) != len(cols):
            raise ValueError("no columns, or one twice")
        self._columns = [_name(c) for c in cols]

    def where(self, column: str, op: str, val: str) -> None:
        _name(column)
        if op not in OPS:
            raise ValueError("unknown operator")
        if val == "":
            raise ValueError("empty value")
        self._values.append(val)
        self._conditions.append(f"{column} {op} ${len(self._values)}")

    def orderBy(self, column: str, desc: bool) -> None:
        if _name(column) in self._ordered:
            raise ValueError("already ordered by it")
        self._ordered.add(column)
        self._order.append(f"{column} {'DESC' if desc else 'ASC'}")

    def limit(self, n: int) -> None:
        if not 1 <= n <= MAX_LIMIT:
            raise ValueError("limit out of range")
        self._limit = n

    def build(self) -> str:
        sql = f"SELECT {', '.join(self._columns) or '*'} FROM {self._table}"
        sql += "".join(self._joins)
        if self._conditions:
            sql += " WHERE " + " AND ".join(self._conditions)
        if self._order:
            sql += " ORDER BY " + ", ".join(self._order)
        if self._limit is not None:
            sql += f" LIMIT {self._limit}"
        return sql

    def params(self) -> list[str]:
        return list(self._values)

    # The extension round: joining another table.
    def innerJoin(self, table: str, leftColumn: str, rightColumn: str) -> None:
        for identifier in (table, leftColumn, rightColumn):
            _name(identifier)
        if table in self._joined:
            raise ValueError("table already in the query")
        self._joined.add(table)
        self._joins.append(f" INNER JOIN {table} ON {self._table}.{leftColumn} = {table}.{rightColumn}")
