"""Difficulty from real answers (Q-3, Q-P2-19, P2-W9-S08): a one-parameter (Rasch) item
response model, fitted by joint maximum likelihood. Pure: the weekly job reads the
answers, fits, and stores each question's level.

- A person or question whose answers are all right or all wrong has no finite
  estimate, so it is left out of the fit, repeatedly, until none is left.
- Questions that share no users (people who read different articles) can't be placed
  on one scale: each connected group is fitted on its own, against its own users.
- Each group's scale is centred on all its users (mean ability 0): a difficulty of 0
  is an even chance for a typical user there. Users left out for getting everything
  right or wrong are placed from the fitted difficulties, with half a point taken off
  a perfect score (or added to a zero), so easy questions don't look harder for it.
- Joint maximum likelihood inflates estimates when each person answers few questions;
  they are scaled by (L - 1) / L, L the mean answers per person (Wright).
- A fit that doesn't settle (data with no finite answer) says so; the job then leaves
  levels as they are.

shortcut: pure Python over every answer each week; fine for tens of thousands of
answers, window the answers or use numpy past that."""

import math
from collections import defaultdict
from dataclasses import dataclass
from typing import Literal

type Level = Literal["beginner", "intermediate", "advanced"]

MAX_ITERATIONS = 500
TOLERANCE = 1e-6
MAX_STEP = 1.0  # Newton steps stay small while the scale settles
# Suggested default (2026-10-28): half a logit either side of even odds for a typical
# user (right about 62% and 38% of the time).
EASY_BELOW = -0.5
HARD_ABOVE = 0.5


@dataclass(frozen=True)
class Answer:
    person: str
    item: int
    correct: bool


@dataclass(frozen=True)
class Fit:
    difficulties: dict[int, float]
    converged: bool
    components: int


def level_of(difficulty: float) -> Level:
    if difficulty < EASY_BELOW:
        return "beginner"
    if difficulty > HARD_ABOVE:
        return "advanced"
    return "intermediate"


def _p(theta: float, b: float) -> float:
    return 1 / (1 + math.exp(-(theta - b)))


def _informative(answers: list[Answer]) -> list[Answer]:
    kept = answers
    while True:
        right: dict[str, int] = defaultdict(int)
        seen: dict[str, int] = defaultdict(int)
        item_right: dict[int, int] = defaultdict(int)
        item_seen: dict[int, int] = defaultdict(int)
        for a in kept:
            seen[a.person] += 1
            right[a.person] += a.correct
            item_seen[a.item] += 1
            item_right[a.item] += a.correct
        extreme_people = {p for p, n in seen.items() if right[p] in (0, n)}
        extreme_items = {i for i, n in item_seen.items() if item_right[i] in (0, n)}
        if not extreme_people and not extreme_items:
            return kept
        kept = [
            a
            for a in kept
            if a.person not in extreme_people and a.item not in extreme_items
        ]


def _components(answers: list[Answer]) -> list[list[Answer]]:
    parent: dict[str, str] = {}

    def find(node: str) -> str:
        parent.setdefault(node, node)
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node

    for a in answers:
        parent[find(f"p:{a.person}")] = find(f"i:{a.item}")
    groups: dict[str, list[Answer]] = defaultdict(list)
    for a in answers:
        groups[find(f"i:{a.item}")].append(a)
    return list(groups.values())


def _ability(answers: list[tuple[float, bool]]) -> float:
    """A person's ability from their answers to fitted questions (difficulty, right);
    a perfect or zero score is moved half a point in."""
    score = sum(right for _, right in answers)
    if score == len(answers):
        score -= 0.5
    elif score == 0:
        score = 0.5
    theta = 0.0
    for _ in range(100):
        expected = sum(_p(theta, b) for b, _ in answers)
        information = sum(_p(theta, b) * (1 - _p(theta, b)) for b, _ in answers)
        step = max(-MAX_STEP, min(MAX_STEP, (score - expected) / information))
        theta += step
        if abs(step) < TOLERANCE:
            break
    return theta


def _fit_group(kept: list[Answer]) -> tuple[dict[int, float], dict[str, float], bool]:
    people = sorted({a.person for a in kept})
    items = sorted({a.item for a in kept})
    theta = dict.fromkeys(people, 0.0)
    b = dict.fromkeys(items, 0.0)
    for _ in range(MAX_ITERATIONS):
        change = 0.0
        # People given the questions, then questions given the people.
        gradient: dict[str, float] = defaultdict(float)
        information: dict[str, float] = defaultdict(float)
        for a in kept:
            p = _p(theta[a.person], b[a.item])
            gradient[a.person] += a.correct - p
            information[a.person] += p * (1 - p)
        for person in people:
            step = max(-MAX_STEP, min(MAX_STEP, gradient[person] / information[person]))
            theta[person] += step
            change = max(change, abs(step))
        item_gradient: dict[int, float] = defaultdict(float)
        item_information: dict[int, float] = defaultdict(float)
        for a in kept:
            p = _p(theta[a.person], b[a.item])
            item_gradient[a.item] += p - a.correct
            item_information[a.item] += p * (1 - p)
        for item in items:
            step = max(
                -MAX_STEP, min(MAX_STEP, item_gradient[item] / item_information[item])
            )
            b[item] += step
            change = max(change, abs(step))
        mean = sum(theta.values()) / len(theta)
        for person in people:
            theta[person] -= mean
        for item in items:
            b[item] -= mean
        if change < TOLERANCE:
            return b, theta, True
    return b, theta, False


def fit_rasch(answers: list[Answer]) -> Fit:
    """Each informative question's difficulty in logits, a typical user at 0."""
    kept = _informative(answers)
    groups = _components(kept)
    difficulties: dict[int, float] = {}
    converged = True
    for group in groups:
        b, theta, settled = _fit_group(group)
        converged = converged and settled
        per_person = len(group) / len(theta)
        shrink = (per_person - 1) / per_person if per_person > 1 else 1.0
        b = {item: value * shrink for item, value in b.items()}
        abilities = [value * shrink for value in theta.values()]
        # Everyone else who answered these questions, placed from them.
        others: dict[str, list[tuple[float, bool]]] = defaultdict(list)
        for a in answers:
            if a.item in b and a.person not in theta:
                others[a.person].append((b[a.item], a.correct))
        abilities += [_ability(mine) for mine in others.values()]
        centre = sum(abilities) / len(abilities)
        difficulties |= {item: value - centre for item, value in b.items()}
    return Fit(difficulties, converged, len(groups))
