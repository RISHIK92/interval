"""The tagging eval (AI-5; ADR-0010: it picks the tagging model on accuracy and cost).
The owner labels about 30 moments with their concepts and difficulty; `eval-tagging`
tags those items with a candidate model and prompt, scores the moments, totals the
cost, and fails below the thresholds. It never stores tags.

Labels name a moment by its item's canonical URL and its heading (null for the intro),
so a label file works against any database the items were ingested into.

Concept scores are micro-averaged over every labelled moment; difficulty is plain
accuracy. The default thresholds (F1 0.7, difficulty 0.6) are overnight picks for the
owner to set (2026-10-26).
"""

from dataclasses import dataclass
from decimal import Decimal
from typing import cast

import yaml

from interval_db.generated import Difficulty
from interval_jobs.ai.gateway import AiGateway, OverBudget
from interval_jobs.headings import heading_key
from interval_jobs.ports import Store, Tags
from interval_jobs.tagging import DIFFICULTIES, tag_item

MIN_F1 = 0.7
MIN_DIFFICULTY = 0.6


class EvalError(ValueError):
    pass


@dataclass(frozen=True)
class Label:
    url: str
    moment: str | None  # the moment's heading; None for the intro
    difficulty: Difficulty
    concepts: frozenset[str]


@dataclass(frozen=True)
class Report:
    moments: int
    precision: float
    recall: float
    f1: float
    difficulty_accuracy: float
    cost_usd: Decimal
    passed: bool


def parse_labels(text: str, path: str) -> list[Label]:
    loaded: object = yaml.safe_load(text)
    if not isinstance(loaded, dict):
        raise EvalError(f"{path}: expected `version` and `moments`")
    raw = cast(dict[object, object], loaded).get("moments")
    if not isinstance(raw, list) or not raw:
        raise EvalError(f"{path}: moments must be a non-empty list")
    labels: list[Label] = []
    for index, entry in enumerate(cast(list[object], raw)):
        where = f"{path}: moment {index + 1}"
        if not isinstance(entry, dict):
            raise EvalError(f"{where}: expected a mapping")
        fields = cast(dict[str, object], entry)
        url, moment = fields.get("url"), fields.get("moment")
        difficulty, concepts = fields.get("difficulty"), fields.get("concepts")
        if not isinstance(url, str) or not url:
            raise EvalError(f"{where}: url is required")
        if moment is not None and not isinstance(moment, str):
            raise EvalError(f"{where}: moment must be a heading, or null for the intro")
        if difficulty not in DIFFICULTIES:
            raise EvalError(f"{where}: difficulty must be one of {DIFFICULTIES}")
        if not isinstance(concepts, list) or not all(
            isinstance(c, str) for c in cast(list[object], concepts)
        ):
            raise EvalError(f"{where}: concepts must be a list of slugs")
        labels.append(
            Label(
                url,
                moment,
                cast(Difficulty, difficulty),
                frozenset(str(c) for c in cast(list[object], concepts)),
            )
        )
    return labels


def _key(url: str, heading: str | None) -> tuple[str, str | None]:
    return url, None if heading is None else heading_key(heading)


def score(
    labels: list[Label],
    predicted: dict[tuple[str, str | None], Tags],
    cost_usd: Decimal = Decimal(0),
    min_f1: float = MIN_F1,
    min_difficulty: float = MIN_DIFFICULTY,
) -> Report:
    hits = guessed = expected = right_level = 0
    for label in labels:
        tags = predicted.get(_key(label.url, label.moment))
        expected += len(label.concepts)
        if tags is None:
            continue
        hits += len(tags.concepts & label.concepts)
        guessed += len(tags.concepts)
        right_level += tags.difficulty == label.difficulty
    precision = hits / guessed if guessed else 0.0
    recall = hits / expected if expected else 0.0
    f1 = 2 * precision * recall / (precision + recall) if hits else 0.0
    accuracy = right_level / len(labels)
    return Report(
        moments=len(labels),
        precision=precision,
        recall=recall,
        f1=f1,
        difficulty_accuracy=accuracy,
        cost_usd=cost_usd,
        passed=f1 >= min_f1 and accuracy >= min_difficulty,
    )


def run_eval(
    gateway: AiGateway,
    model: str,
    store: Store,
    labels: list[Label],
    min_f1: float = MIN_F1,
    min_difficulty: float = MIN_DIFFICULTY,
) -> Report:
    """Tags every labelled item with `model` (costed through the gateway), stores
    nothing, and scores the labelled moments."""
    graph = store.concepts.state()
    predicted: dict[tuple[str, str | None], Tags] = {}
    cost = Decimal(0)
    for url in sorted({label.url for label in labels}):
        item_id = store.tags.find(url)
        item = store.tags.input(item_id) if item_id is not None else None
        if item is None:
            raise EvalError(f"labelled item {url} is not in this database")
        tagged = tag_item(gateway, model, item, graph)
        if isinstance(tagged, OverBudget):
            raise EvalError(f"the {tagged.scope} AI budget is spent for today")
        cost += tagged.cost_usd
        headings = {m.id: m.heading for m in item.moments}
        for moment_id, tags in tagged.result.moments.items():
            predicted[_key(url, headings[moment_id])] = tags
    return score(labels, predicted, cost, min_f1, min_difficulty)
