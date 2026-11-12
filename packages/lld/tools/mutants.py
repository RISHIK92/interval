"""Mutants of a Python reference solution, for mutation testing (LLDQ-2, P5-W30-S02).

Standard library only (Python 3.9+, for ast.unparse): no packages. Prints a JSON list of
{"line", "kind", "source"}: one small change each (a flipped comparison, a swapped
operator, a constant off by one, a negated condition...), every one valid Python and
different from the original. A problem's tests must catch at least 90% of them.

Constants inside a raise or an annotation are left alone: errors are compared by kind,
never by message, so changing them can't be caught, and counting them would only lower
every problem's score for nothing.

Usage: python3 mutants.py solution.py
"""

from __future__ import annotations

import ast
import copy
import json
import sys
from dataclasses import dataclass

COMPARE: dict[type[ast.cmpop], type[ast.cmpop]] = {
    ast.Lt: ast.LtE,
    ast.LtE: ast.Lt,
    ast.Gt: ast.GtE,
    ast.GtE: ast.Gt,
    ast.Eq: ast.NotEq,
    ast.NotEq: ast.Eq,
    ast.In: ast.NotIn,
    ast.NotIn: ast.In,
    ast.Is: ast.IsNot,
    ast.IsNot: ast.Is,
}
ARITH: dict[type[ast.operator], type[ast.operator]] = {
    ast.Add: ast.Sub,
    ast.Sub: ast.Add,
    ast.Mult: ast.FloorDiv,
    ast.FloorDiv: ast.Mult,
    ast.Div: ast.Mult,
    ast.Mod: ast.FloorDiv,
}


@dataclass(frozen=True)
class Site:
    """One change: the node's position in ast.walk order, the kind, and for a
    comparison which of its operators."""

    walk: int
    kind: str
    operand: int = 0


def _frozen(tree: ast.AST) -> set[int]:
    """Walk positions of nodes inside a raise or an annotation."""
    inside: set[int] = set()
    roots: list[ast.AST] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Raise):
            roots.append(node)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.returns:
            roots.append(node.returns)
        elif isinstance(node, ast.arg) and node.annotation:
            roots.append(node.annotation)
        elif isinstance(node, ast.AnnAssign):
            roots.append(node.annotation)
    ids = {id(n) for root in roots for n in ast.walk(root)}
    for i, node in enumerate(ast.walk(tree)):
        if id(node) in ids:
            inside.add(i)
    return inside


def sites(tree: ast.AST) -> list[Site]:
    """Every place one small change can be made, in ast.walk order."""
    frozen = _frozen(tree)
    found: list[Site] = []
    for i, node in enumerate(ast.walk(tree)):
        if isinstance(node, ast.Compare):
            found += [
                Site(i, "compare", j)
                for j, op in enumerate(node.ops)
                if type(op) in COMPARE
            ]
        elif isinstance(node, ast.BinOp) and type(node.op) in ARITH:
            found.append(Site(i, "arith"))
        elif isinstance(node, ast.AugAssign) and type(node.op) in ARITH:
            found.append(Site(i, "augassign"))
        elif isinstance(node, ast.BoolOp):
            found.append(Site(i, "boolop"))
        elif isinstance(node, ast.Constant) and i not in frozen:
            if isinstance(node.value, bool):
                found.append(Site(i, "bool"))
            elif type(node.value) is int:
                found += [Site(i, "constant+1"), Site(i, "constant-1")]
        elif isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
            found.append(Site(i, "not"))
        elif isinstance(node, ast.Return) and node.value is not None:
            found.append(Site(i, "return"))
        elif isinstance(node, (ast.If, ast.While)):
            found.append(Site(i, "condition"))
    return found


def _replace(tree: ast.AST, old: ast.AST, new: ast.AST) -> None:
    """Put new where old is, in old's parent."""
    for parent in ast.walk(tree):
        for field, value in ast.iter_fields(parent):
            if value is old:
                setattr(parent, field, new)
                return
            if isinstance(value, list):
                items: list[object] = value  # type: ignore[assignment]
                for k, item in enumerate(items):
                    if item is old:
                        items[k] = new
                        return


def apply(tree: ast.AST, site: Site) -> int:
    """Make one change in place; the changed node's line."""
    node = list(ast.walk(tree))[site.walk]
    line: int = getattr(node, "lineno", 0)
    if site.kind == "compare" and isinstance(node, ast.Compare):
        node.ops[site.operand] = COMPARE[type(node.ops[site.operand])]()
    elif site.kind in ("arith", "augassign") and isinstance(
        node, (ast.BinOp, ast.AugAssign)
    ):
        node.op = ARITH[type(node.op)]()
    elif site.kind == "boolop" and isinstance(node, ast.BoolOp):
        node.op = ast.Or() if isinstance(node.op, ast.And) else ast.And()
    elif site.kind == "bool" and isinstance(node, ast.Constant):
        node.value = not node.value
    elif site.kind in ("constant+1", "constant-1") and isinstance(node, ast.Constant):
        assert type(node.value) is int
        node.value = node.value + (1 if site.kind == "constant+1" else -1)
    elif site.kind == "not" and isinstance(node, ast.UnaryOp):
        # "not x" becomes "x": only this node is unwrapped.
        _replace(tree, node, node.operand)
    elif site.kind == "return" and isinstance(node, ast.Return):
        node.value = ast.Constant(None)
    elif site.kind == "condition" and isinstance(node, (ast.If, ast.While)):
        node.test = ast.UnaryOp(ast.Not(), node.test)
    else:
        raise AssertionError(f"site {site} doesn't fit its node")
    return line


def mutants(source: str) -> list[dict[str, object]]:
    original = ast.parse(source)
    baseline = ast.unparse(original)
    out: list[dict[str, object]] = []
    seen: set[str] = set()
    for site in sites(original):
        tree = copy.deepcopy(original)
        line = apply(tree, site)
        text = ast.unparse(ast.fix_missing_locations(tree))
        if text == baseline or text in seen:
            continue
        try:
            compile(text, "<mutant>", "exec")
        except SyntaxError:
            continue
        seen.add(text)
        out.append({"line": line, "kind": site.kind, "source": text + "\n"})
    return out


if __name__ == "__main__":
    with open(sys.argv[1], encoding="utf-8") as f:
        json.dump(mutants(f.read()), sys.stdout)
