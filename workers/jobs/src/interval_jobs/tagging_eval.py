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

from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal
from typing import cast

import yaml

from interval_db.generated import Difficulty
from interval_jobs.ai.gateway import AiGateway, OverBudget
from interval_jobs.concept_vectors import concept_text, text_hash
from interval_jobs.headings import heading_key
from interval_jobs.ports import Store, Tags
from interval_jobs.tagging import DIFFICULTIES, MOMENT_CHARS, moment_texts, tag_item
from interval_jobs.tagging_shortlist import alias_hits, recall, shortlist

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


@dataclass(frozen=True)
class ShortlistReport:
    moments: int
    # variant -> shortlist size -> share of labelled concepts kept
    recall: dict[str, dict[int, float]]
    mean_text_hits: float  # concepts per moment found by name or alias
    cost_usd: Decimal


SHORTLIST_SIZES = (10, 15, 20, 25)
_EMBED_BATCH = 32  # Voyage caps texts and tokens per request


def run_shortlist_eval(
    gateway: AiGateway,
    model: str,
    store: Store,
    labels: list[Label],
    sizes: tuple[int, ...] = SHORTLIST_SIZES,
) -> ShortlistReport:
    """How many labelled concepts each variant of the shortlist keeps (2026-10-27):
    embeddings alone, plus name and alias hits, plus the article prior. Moments and
    titles are embedded through the gateway (`model`, the concepts' model); nothing is
    stored. Missing or stale concept vectors, and labels naming no active concept, are
    refused: both would only lower recall without saying why."""
    graph = store.concepts.state()
    vectors = {slug: v for slug, (_, v) in store.concepts.vectors(model).items()}
    stored = store.concepts.vectors(model)
    active = {c.slug: c for c in graph.concepts if not c.retired} if graph else {}
    stale = [
        slug
        for slug, c in active.items()
        if stored.get(slug, ("",))[0] != text_hash(concept_text(c.name, c.description))
    ]
    if graph is None or not vectors or stale:
        raise EvalError(
            f"{len(stale) or 'all'} concept vectors missing or stale for {model}: "
            "run embed-concepts first"
        )
    unknown = sorted({s for label in labels for s in label.concepts} - set(active))
    if unknown:
        raise EvalError(f"labels name unknown concepts: {', '.join(unknown[:10])}")
    cases: list[tuple[set[str], str, int]] = []  # labelled, section text, item
    priors: dict[int, str] = {}
    for label in labels:
        item_id = store.tags.find(label.url)
        item = store.tags.input(item_id) if item_id is not None else None
        if item is None or item_id is None:
            raise EvalError(f"labelled item {label.url} is not in this database")
        texts = moment_texts(item.full_text, item.moments) if item.full_text else {}
        moment = next(
            (
                m
                for m in item.moments
                if _key(label.url, m.heading) == _key(label.url, label.moment)
            ),
            None,
        )
        if moment is None or moment.id not in texts:
            raise EvalError(f"{label.url}: no text for moment {label.moment!r}")
        cases.append((set(label.concepts), texts[moment.id][:MOMENT_CHARS], item_id))
        priors[item_id] = f"{item.title}\n{item.summary or ''}".strip()

    cost = Decimal(0)

    def embedded(texts: list[str]) -> list[list[float]]:
        nonlocal cost
        out: list[list[float]] = []
        for start in range(0, len(texts), _EMBED_BATCH):
            result = gateway.embed(
                feature="embeddings",
                user_id=None,
                model=model,
                texts=texts[start : start + _EMBED_BATCH],
                purpose="document",
            )
            if isinstance(result, OverBudget):
                raise EvalError(f"the {result.scope} AI budget is spent for today")
            cost += result.usage.cost_usd
            out.extend(result.vectors)
        return out

    moments = embedded([text for _, text, _ in cases])
    prior_ids = sorted(priors)
    prior_vectors = dict(
        zip(prior_ids, embedded([priors[i] for i in prior_ids]), strict=True)
    )
    variants: dict[str, Callable[[int, int], list[str]]] = {
        "embeddings": lambda i, size: shortlist(
            moments[i], None, "", vectors, graph, size=size, prior_size=0
        ),
        "embeddings+aliases": lambda i, size: shortlist(
            moments[i], None, cases[i][1], vectors, graph, size=size, prior_size=0
        ),
        "embeddings+aliases+prior": lambda i, size: shortlist(
            moments[i],
            prior_vectors[cases[i][2]],
            cases[i][1],
            vectors,
            graph,
            size=size,
        ),
    }
    report = {
        name: {
            size: recall(
                (labelled, pick(i, size)) for i, (labelled, _, _) in enumerate(cases)
            )
            for size in sizes
        }
        for name, pick in variants.items()
    }
    hits = sum(len(alias_hits(text, graph)) for _, text, _ in cases)
    return ShortlistReport(len(cases), report, hits / len(cases), cost)
