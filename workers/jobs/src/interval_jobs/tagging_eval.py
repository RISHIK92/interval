"""The tagging eval (AI-5; ADR-0010: it picks the tagging model on accuracy and cost).
The owner labels articles with their concepts and difficulty; `eval-tagging` tags
those items with a candidate model and prompt, scores the articles, totals the cost,
and fails below the thresholds. It never stores tags.

Labels name an article by its canonical URL, so a label file works against any
database the items were ingested into. Articles are tagged whole (ADR-0058): the
labels a file gives one article (moment-era files label its sections, by `moment`
heading) are read as one: the union of their concepts, at their median level.

Concept scores are micro-averaged over every labelled article; difficulty is plain
accuracy. The default thresholds (F1 0.7, difficulty 0.6) are overnight picks for the
owner to set (2026-10-26).
"""

from collections.abc import Callable
from dataclasses import dataclass, replace
from decimal import Decimal
from statistics import median_low
from typing import cast

import yaml

from interval_db.generated import Difficulty
from interval_jobs.ai.gateway import AiGateway, OverBudget
from interval_jobs.concept_vectors import concept_text, text_hash
from interval_jobs.ports import Store, TagInput, Tags
from interval_jobs.tagging import DECISIONS_PREFIX, DIFFICULTIES, tag_item
from interval_jobs.tagging_decide import article_text, decide
from interval_jobs.tagging_rollup import DEFAULT_CUTOFFS, Cutoffs, rollup
from interval_jobs.tagging_shortlist import alias_hits, recall, shortlist

MIN_F1 = 0.7
MIN_DIFFICULTY = 0.6
# Easiest first: an article's merged labels take their median (the lower of two).
DIFFICULTIES_BY_RANK: tuple[Difficulty, ...] = ("beginner", "intermediate", "advanced")


class EvalError(ValueError):
    pass


@dataclass(frozen=True)
class Label:
    url: str
    difficulty: Difficulty
    concepts: frozenset[str]


@dataclass(frozen=True)
class Report:
    articles: int
    precision: float
    recall: float
    f1: float
    difficulty_accuracy: float
    cost_usd: Decimal
    passed: bool
    # Decision models only: (cut-off, precision, recall, f1) over stored answers.
    sweep: tuple[tuple[float, float, float, float], ...] = ()
    # Decision models only: why asking stopped part way (budget, model error). The
    # answers before it are kept, and a re-run resumes from them.
    stopped: str | None = None


def parse_labels(text: str, path: str) -> list[Label]:
    loaded: object = yaml.safe_load(text)
    if not isinstance(loaded, dict):
        raise EvalError(f"{path}: expected `version` and `moments`")
    # `moments`: the list's name from when labels named sections (ADR-0058).
    raw = cast(dict[object, object], loaded).get("moments")
    if not isinstance(raw, list) or not raw:
        raise EvalError(f"{path}: moments must be a non-empty list")
    by_url: dict[str, list[tuple[Difficulty, frozenset[str]]]] = {}
    for index, entry in enumerate(cast(list[object], raw)):
        where = f"{path}: label {index + 1}"
        if not isinstance(entry, dict):
            raise EvalError(f"{where}: expected a mapping")
        fields = cast(dict[str, object], entry)
        url = fields.get("url")
        difficulty, concepts = fields.get("difficulty"), fields.get("concepts")
        if not isinstance(url, str) or not url:
            raise EvalError(f"{where}: url is required")
        if difficulty not in DIFFICULTIES:
            raise EvalError(f"{where}: difficulty must be one of {DIFFICULTIES}")
        if not isinstance(concepts, list) or not all(
            isinstance(c, str) for c in cast(list[object], concepts)
        ):
            raise EvalError(f"{where}: concepts must be a list of slugs")
        by_url.setdefault(url, []).append(
            (
                cast(Difficulty, difficulty),
                frozenset(str(c) for c in cast(list[object], concepts)),
            )
        )
    return [
        Label(
            url,
            DIFFICULTIES_BY_RANK[
                median_low(DIFFICULTIES_BY_RANK.index(d) for d, _ in parts)
            ],
            frozenset[str]().union(*(c for _, c in parts)),
        )
        for url, parts in by_url.items()
    ]


def score(
    labels: list[Label],
    predicted: dict[str, Tags],
    cost_usd: Decimal = Decimal(0),
    min_f1: float = MIN_F1,
    min_difficulty: float = MIN_DIFFICULTY,
) -> Report:
    hits = guessed = expected = right_level = 0
    for label in labels:
        tags = predicted.get(label.url)
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
        articles=len(labels),
        precision=precision,
        recall=recall,
        f1=f1,
        difficulty_accuracy=accuracy,
        cost_usd=cost_usd,
        passed=f1 >= min_f1 and accuracy >= min_difficulty,
    )


SWEEP = (0.3, 0.4, 0.5, 0.6, 0.7, 0.8)


def _current_vectors(store: Store, model: str) -> dict[str, list[float]]:
    """Every active concept's vector from `model`, refusing missing or stale ones:
    both would only lower scores without saying why."""
    graph = store.concepts.state()
    stored = store.concepts.vectors(model)
    active = {c.slug: c for c in graph.concepts if not c.retired} if graph else {}
    stale = [
        slug
        for slug, c in active.items()
        if stored.get(slug, ("",))[0] != text_hash(concept_text(c.name, c.description))
    ]
    if not active or stale:
        raise EvalError(
            f"{len(stale) or 'all'} concept vectors missing or stale for {model}: "
            "run embed-concepts first"
        )
    return {slug: stored[slug][1] for slug in active}


def _decisions_eval(
    gateway: AiGateway,
    model: str,
    embedding_model: str,
    store: Store,
    labels: list[Label],
    min_f1: float,
    min_difficulty: float,
) -> Report:
    """Asks the decision model about every labelled article that changed, keeps the
    raw answers (an unchanged one costs nothing next time), then scores the roll-up
    at the default cut-offs and over a sweep."""
    graph = store.concepts.state()
    if graph is None:
        raise EvalError("no concept graph loaded")
    vectors = _current_vectors(store, embedding_model)
    known = set(vectors)
    # Every labelled item checked before anything is paid for.
    found: dict[str, tuple[int, TagInput]] = {}
    for url in sorted({label.url for label in labels}):
        item_id = store.tags.find(url)
        item = store.tags.input(item_id) if item_id is not None else None
        if item is None or item_id is None:
            raise EvalError(f"labelled item {url} is not in this database")
        found[url] = (item_id, item)
    items: dict[str, int] = {}
    # shortcut: the run is one unit of work, so its answer rows stay locked until it
    # ends and a pipeline tag of the same item waits (a deadlock aborts one side); give
    # each item its own unit if evals grow or run beside a busy pipeline.
    cost = Decimal(0)
    stopped: str | None = None
    for url, (item_id, item) in found.items():
        asked = decide(
            gateway,
            model,
            embedding_model,
            item,
            graph,
            vectors,
            store.decisions.item_hash(item_id, model),
        )
        if asked.item is not None:
            store.decisions.save_item(
                item_id,
                model,
                asked.item.content_hash,
                asked.item.difficulty,
                asked.item.probabilities,
                from_full_text=bool(item.full_text),
            )
        cost += asked.cost_usd
        items[url] = item_id
        if asked.refused is not None:
            stopped = f"the {asked.refused.scope} AI budget is spent for today"
        elif asked.stopped is not None:
            stopped = asked.stopped
        if stopped is not None:
            break  # what was answered is kept; scores below cover what exists

    def predicted(cutoffs: Cutoffs) -> dict[str, Tags]:
        return {
            url: rollup(store.decisions.read(item_id, model), known, cutoffs).item
            for url, item_id in items.items()
        }

    sweep = tuple(
        (cut, r.precision, r.recall, r.f1)
        for cut in SWEEP
        for r in [
            score(labels, predicted(replace(DEFAULT_CUTOFFS, session=cut, title=cut)))
        ]
    )
    report = score(labels, predicted(DEFAULT_CUTOFFS), cost, min_f1, min_difficulty)
    return replace(
        report, sweep=sweep, stopped=stopped, passed=report.passed and not stopped
    )


def run_eval(
    gateway: AiGateway,
    model: str,
    store: Store,
    labels: list[Label],
    min_f1: float = MIN_F1,
    min_difficulty: float = MIN_DIFFICULTY,
    embedding_model: str | None = None,
) -> Report:
    """Tags every labelled item with `model` (costed through the gateway), stores no
    tags, and scores the labelled articles. A decision model ("decisions:<id>") also
    needs the concepts' `embedding_model` for its shortlist, and keeps its raw
    answers."""
    if model.startswith(DECISIONS_PREFIX):
        if embedding_model is None:
            raise EvalError("a decision model needs the concepts' embedding model")
        return _decisions_eval(
            gateway,
            model.removeprefix(DECISIONS_PREFIX),
            embedding_model,
            store,
            labels,
            min_f1,
            min_difficulty,
        )
    graph = store.concepts.state()
    predicted: dict[str, Tags] = {}
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
        predicted[url] = tagged.result.item
    return score(labels, predicted, cost, min_f1, min_difficulty)


@dataclass(frozen=True)
class ShortlistReport:
    articles: int
    # variant -> shortlist size -> share of labelled concepts kept
    recall: dict[str, dict[int, float]]
    mean_text_hits: float  # concepts per article found by name or alias
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
    embeddings alone, plus name and alias hits, plus the article prior. Articles (as
    the decision model is asked about them) and titles are embedded through the
    gateway (`model`, the concepts' model); nothing is stored. Missing or stale
    concept vectors, and labels naming no active concept, are refused: both would
    only lower recall without saying why."""
    graph = store.concepts.state()
    vectors = _current_vectors(store, model)
    if graph is None:
        raise EvalError("no concept graph loaded")
    active = set(vectors)
    unknown = sorted({s for label in labels for s in label.concepts} - active)
    if unknown:
        raise EvalError(f"labels name unknown concepts: {', '.join(unknown[:10])}")
    cases: list[tuple[set[str], str, int]] = []  # labelled, article text, item
    priors: dict[int, str] = {}
    for label in labels:
        item_id = store.tags.find(label.url)
        item = store.tags.input(item_id) if item_id is not None else None
        if item is None or item_id is None:
            raise EvalError(f"labelled item {label.url} is not in this database")
        cases.append((set(label.concepts), article_text(item), item_id))
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

    texts = embedded([text for _, text, _ in cases])
    prior_ids = sorted(priors)
    prior_vectors = dict(
        zip(prior_ids, embedded([priors[i] for i in prior_ids]), strict=True)
    )
    variants: dict[str, Callable[[int, int], list[str]]] = {
        "embeddings": lambda i, size: shortlist(
            texts[i], None, "", vectors, graph, size=size, prior_size=0
        ),
        "embeddings+aliases": lambda i, size: shortlist(
            texts[i], None, cases[i][1], vectors, graph, size=size, prior_size=0
        ),
        "embeddings+aliases+prior": lambda i, size: shortlist(
            texts[i],
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
