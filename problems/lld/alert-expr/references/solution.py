from __future__ import annotations

import operator
import re
from abc import ABC, abstractmethod
from collections.abc import Callable

KEYWORDS = ("and", "or", "not")
MAX_DIGITS = 15
OPS: dict[str, Callable[[int, int], bool]] = {
    ">": operator.gt,
    ">=": operator.ge,
    "<": operator.lt,
    "<=": operator.le,
    "==": operator.eq,
    "!=": operator.ne,
}
# A number, a word, an operator or bracket, or any other character (which is an error).
TOKEN = re.compile(
    r" *(?:(-?[0-9]+)|([A-Za-z][A-Za-z0-9_.]*)|(>=|<=|==|!=|[<>()])|([^ ]))"
)
NAME = re.compile(r"[A-Za-z][A-Za-z0-9_.]*")


class Tally:
    def __init__(self) -> None:
        self.comparisons = 0


class Node(ABC):
    """An expression in the language: a comparison, or not, and, or over expressions."""

    @abstractmethod
    def evaluate(self, metrics: dict[str, int], seen: Tally) -> bool:
        """Counts each comparison it evaluates in seen."""

    @abstractmethod
    def depth(self) -> int: ...

    @abstractmethod
    def names(self, out: set[str]) -> None: ...

    @abstractmethod
    def rename(self, old: str, new: str) -> None: ...

    @abstractmethod
    def text(self) -> str: ...


class Compare(Node):
    def __init__(self, metric: str, op: str, value: int) -> None:
        self.metric = metric
        self.op = op
        self.value = value

    def evaluate(self, metrics: dict[str, int], seen: Tally) -> bool:
        seen.comparisons += 1
        current = metrics.get(self.metric)
        return current is not None and OPS[self.op](current, self.value)

    def depth(self) -> int:
        return 1

    def names(self, out: set[str]) -> None:
        out.add(self.metric)

    def rename(self, old: str, new: str) -> None:
        if self.metric == old:
            self.metric = new

    def text(self) -> str:
        return f"{self.metric} {self.op} {self.value}"


class Not(Node):
    def __init__(self, inner: Node) -> None:
        self.inner = inner

    def evaluate(self, metrics: dict[str, int], seen: Tally) -> bool:
        return not self.inner.evaluate(metrics, seen)

    def depth(self) -> int:
        return 1 + self.inner.depth()

    def names(self, out: set[str]) -> None:
        self.inner.names(out)

    def rename(self, old: str, new: str) -> None:
        self.inner.rename(old, new)

    def text(self) -> str:
        return f"not {self.inner.text()}"


class Binary(Node):
    word = ""

    def __init__(self, left: Node, right: Node) -> None:
        self.left = left
        self.right = right

    def depth(self) -> int:
        return 1 + max(self.left.depth(), self.right.depth())

    def names(self, out: set[str]) -> None:
        self.left.names(out)
        self.right.names(out)

    def rename(self, old: str, new: str) -> None:
        self.left.rename(old, new)
        self.right.rename(old, new)

    def text(self) -> str:
        return f"({self.left.text()} {self.word} {self.right.text()})"


class And(Binary):
    word = "and"

    def evaluate(self, metrics: dict[str, int], seen: Tally) -> bool:
        return self.left.evaluate(metrics, seen) and self.right.evaluate(metrics, seen)


class Or(Binary):
    word = "or"

    def evaluate(self, metrics: dict[str, int], seen: Tally) -> bool:
        return self.left.evaluate(metrics, seen) or self.right.evaluate(metrics, seen)


class Parser:
    """Recursive descent: each method parses one level of the grammar."""

    def __init__(self, text: str) -> None:
        self.tokens: list[tuple[str, str]] = []
        for number, word, symbol, other in TOKEN.findall(text):
            if other:
                raise ValueError("unexpected character")
            kind = "number" if number else "word" if word else "symbol"
            self.tokens.append((kind, number + word + symbol))
        self.pos = 0

    def parse(self) -> Node:
        tree = self.disjunction()
        if self.pos != len(self.tokens):
            raise ValueError("unexpected token")
        return tree

    def disjunction(self) -> Node:
        tree = self.conjunction()
        for _ in range(len(self.tokens)):
            if not self.take("or"):
                break
            tree = Or(tree, self.conjunction())
        return tree

    def conjunction(self) -> Node:
        tree = self.negation()
        for _ in range(len(self.tokens)):
            if not self.take("and"):
                break
            tree = And(tree, self.negation())
        return tree

    def negation(self) -> Node:
        if self.take("not"):
            return Not(self.negation())
        if self.take("("):
            tree = self.disjunction()
            self.expect("symbol", ")")
            return tree
        metric = self.expect("word")
        if metric in KEYWORDS:
            raise ValueError("a keyword is not a metric")
        op = self.expect("symbol")
        if op not in OPS:
            raise ValueError("not a comparison")
        number = self.expect("number")
        if len(number.lstrip("-")) > MAX_DIGITS:
            raise ValueError("number too long")
        return Compare(metric, op, int(number))

    def take(self, text: str) -> bool:
        found = self.pos < len(self.tokens) and self.tokens[self.pos][1] == text
        if found:
            self.pos += 1
        return found

    def expect(self, kind: str, text: str | None = None) -> str:
        if self.pos == len(self.tokens):
            raise ValueError("unexpected end")
        got_kind, got = self.tokens[self.pos]
        if got_kind != kind or (text is not None and got != text):
            raise ValueError("unexpected token")
        self.pos += 1
        return got


class AlertExpr:
    def __init__(self, expression: str) -> None:
        self._tree = Parser(expression).parse()
        self._seen = Tally()

    def evaluate(self, metrics: dict[str, int]) -> bool:
        return self._tree.evaluate(metrics, self._seen)

    def variables(self) -> list[str]:
        out: set[str] = set()
        self._tree.names(out)
        return sorted(out)

    def depth(self) -> int:
        return self._tree.depth()

    def evaluations(self) -> int:
        return self._seen.comparisons

    # The extension round: renaming a metric in the parsed tree.
    def rewrite(self, name: str, replacement: str) -> str:
        valid = NAME.fullmatch(replacement) is not None and replacement not in KEYWORDS
        if name not in self.variables() or not valid:
            raise ValueError("unknown metric or bad name")
        self._tree.rename(name, replacement)
        return self._tree.text()
