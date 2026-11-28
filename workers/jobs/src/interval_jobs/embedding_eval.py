"""The embeddings eval (ADR-0007, Q-P1-27: the Week 3 eval picks the Voyage model).

The owner writes queries and names the articles that answer each one, by canonical URL,
plus distractor items: articles none of the queries is about. `eval-embeddings` embeds
every labelled and distractor article as the candidate pool (one vector each, as the
pipeline embeds them, ADR-0058), embeds the queries, ranks the pool by cosine, and
reports recall@5, mean reciprocal rank and cost. It stores nothing. A moment-era file's
`relevant` entries name sections by `moment` heading too; only their URL counts now.

A pool of a handful of articles can't tell models apart, so the eval refuses one under
MIN_POOL articles (the slice asks for about 50). The pass mark (recall@5 of
0.6) and MIN_POOL are overnight picks for the owner to set (2026-10-26).
"""

import math
from dataclasses import dataclass
from decimal import Decimal
from typing import cast

import yaml

from interval_jobs.ai.gateway import AiGateway, OverBudget
from interval_jobs.embedding import embed_item
from interval_jobs.ports import Store

MIN_RECALL = 0.6
MIN_POOL = 50
K = 5


class EvalError(ValueError):
    pass


@dataclass(frozen=True)
class Query:
    query: str
    relevant: frozenset[str]  # canonical URLs


@dataclass(frozen=True)
class QuerySet:
    queries: list[Query]
    distractors: list[str]  # canonical URLs


@dataclass(frozen=True)
class Report:
    queries: int
    pool: int
    recall_at_5: float
    mrr: float
    cost_usd: Decimal
    passed: bool


def parse_queries(text: str, path: str) -> QuerySet:
    loaded: object = yaml.safe_load(text)
    doc = cast(dict[object, object], loaded) if isinstance(loaded, dict) else {}
    raw, distractors = doc.get("queries"), doc.get("distractors", [])
    if not isinstance(raw, list) or not raw:
        raise EvalError(f"{path}: queries must be a non-empty list")
    if not isinstance(distractors, list) or not all(
        isinstance(u, str) for u in cast(list[object], distractors)
    ):
        raise EvalError(f"{path}: distractors must be a list of URLs")
    queries: list[Query] = []
    for index, entry in enumerate(cast(list[object], raw)):
        where = f"{path}: query {index + 1}"
        fields = cast(dict[str, object], entry) if isinstance(entry, dict) else {}
        query, relevant = fields.get("query"), fields.get("relevant")
        if not isinstance(query, str) or not query.strip():
            raise EvalError(f"{where}: query is required")
        if not isinstance(relevant, list) or not relevant:
            raise EvalError(f"{where}: relevant must name at least one article")
        keys: set[str] = set()
        for article in cast(list[object], relevant):
            a = cast(dict[str, object], article) if isinstance(article, dict) else {}
            url = a.get("url")
            if not isinstance(url, str) or not url:
                raise EvalError(f"{where}: each relevant article needs its url")
            keys.add(url)
        queries.append(Query(query.strip(), frozenset(keys)))
    return QuerySet(queries, [str(u) for u in cast(list[object], distractors)])


def rank_score(
    ranked: list[list[str]], relevant: list[set[str]], k: int = K
) -> tuple[float, float]:
    """Recall@k (share of relevant articles in the top k, averaged over queries) and
    mean reciprocal rank of the first relevant article."""
    recalls: list[float] = []
    reciprocal: list[float] = []
    for order, wanted in zip(ranked, relevant, strict=True):
        recalls.append(len(set(order[:k]) & wanted) / len(wanted))
        first = next((i for i, key in enumerate(order) if key in wanted), None)
        reciprocal.append(0.0 if first is None else 1 / (first + 1))
    return sum(recalls) / len(recalls), sum(reciprocal) / len(reciprocal)


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    norm = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return dot / norm if norm else 0.0


def run_eval(
    gateway: AiGateway,
    model: str,
    store: Store,
    labelled: QuerySet,
    min_recall: float = MIN_RECALL,
    min_pool: int = MIN_POOL,
) -> Report:
    queries = labelled.queries
    pool: dict[str, list[float]] = {}
    cost = Decimal(0)
    urls = {url for q in queries for url in q.relevant} | set(labelled.distractors)
    for url in sorted(urls):
        item_id = store.tags.find(url)
        item = store.tags.input(item_id) if item_id is not None else None
        if item is None:
            raise EvalError(f"item {url} is not in this database")
        embedded = embed_item(gateway, model, item)
        cost += embedded.cost_usd
        if embedded.refused is not None:
            raise EvalError(f"the {embedded.refused.scope} AI budget is spent today")
        if embedded.vector is not None:
            pool[url] = embedded.vector
    relevant = [set(q.relevant) for q in queries]
    unknown = sorted({url for urls in relevant for url in urls} - set(pool))
    if unknown:
        raise EvalError(f"labelled articles with no stored text: {unknown}")
    if len(pool) < min_pool:
        raise EvalError(
            f"the pool has {len(pool)} articles; add distractors to reach {min_pool}"
        )
    asked = gateway.embed(
        feature="embeddings",
        user_id=None,
        model=model,
        texts=[q.query for q in queries],
        purpose="query",
    )
    if isinstance(asked, OverBudget):
        raise EvalError(f"the {asked.scope} AI budget is spent today")
    cost += asked.usage.cost_usd
    ranked = [
        sorted(pool, key=lambda key, v=vector: -_cosine(v, pool[key]))
        for vector in asked.vectors
    ]
    recall, mrr = rank_score(ranked, relevant)
    return Report(len(queries), len(pool), recall, mrr, cost, recall >= min_recall)
