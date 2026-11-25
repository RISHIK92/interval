"""LLD practice problems name live concepts (Q-WD-30, ADR-0048): every slug in a
practice problem's `concepts` is in the concept seed, parsed by its own loader, and not
retired. The problem files are packages/lld's to validate; this checks only the link."""

import json
from pathlib import Path
from typing import cast

import pytest

from interval_jobs.concepts.graph import parse_concepts

REPO = Path(__file__).resolve().parents[3]
SEED = REPO / "workers" / "jobs" / "seeds" / "concepts.yaml"
PROBLEMS = REPO / "problems" / "lld"


def _live() -> frozenset[str]:
    graph = parse_concepts(SEED.read_text(encoding="utf-8"), str(SEED))
    return frozenset(c.slug for c in graph.concepts if not c.retired)


def _practice() -> list[tuple[str, list[str]]]:
    found: list[tuple[str, list[str]]] = []
    for path in sorted(PROBLEMS.glob("*/problem.json")):
        problem: object = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(problem, dict):
            continue  # not a problem file: packages/lld's own tests say so
        fields = {str(k): v for k, v in cast(dict[object, object], problem).items()}
        concepts = fields.get("concepts")
        if fields.get("pool") == "practice" and isinstance(concepts, list):
            slugs = [str(c) for c in cast(list[object], concepts)]
            found.append((path.parent.name, slugs))
    return found


def test_the_seed_has_the_software_design_concepts() -> None:
    assert {"encapsulation", "strategy-pattern", "null-object-pattern"} <= _live()


@pytest.mark.parametrize(("slug", "concepts"), _practice())
def test_a_practice_problems_concepts_are_live(slug: str, concepts: list[str]) -> None:
    assert [c for c in concepts if c not in _live()] == [], slug
