"""The embeddings eval (ADR-0007, Q-P1-27: the Week 3 eval picks the Voyage model).

The owner writes queries and names the moments that answer each one, by canonical URL
and heading (null for the intro), plus distractor items: articles none of the queries
is about. `eval-embeddings` embeds every moment of the labelled and distractor items as
the candidate pool, embeds the queries, ranks the pool by cosine, and reports recall@5,
mean reciprocal rank and cost. It stores nothing.

A pool of a handful of sibling sections can't tell models apart, so the eval refuses
one under MIN_POOL moments (the slice asks for about 50). The pass mark (recall@5 of
0.6) and MIN_POOL are overnight picks for the owner to set (2026-10-26).
"""

import math
from dataclasses import dataclass
from decimal import Decimal
from typing import cast

import yaml

from interval_jobs.ai.gateway import AiGateway, OverBudget
from interval_jobs.embedding import embed_item
from interval_jobs.headings import heading_key
from interval_jobs.ports import Store

MIN_RECALL = 0.6
MIN_POOL = 50
K = 5

type MomentKey = tuple[str, str | None]  # (canonical URL, heading key or None)


class EvalError(ValueError):
    pass


@dataclass(frozen=True)
class Query:
    query: str
    relevant: frozenset[MomentKey]


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


def _key(url: str, heading: str | None) -> MomentKey:
    return url, None if heading is None else heading_key(heading)


def _pool_key(key: MomentKey) -> str:
    return f"{key[0]}|{key[1]}"


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
            raise EvalError(f"{where}: relevant must name at least one moment")
        keys: set[MomentKey] = set()
        for moment in cast(list[object], relevant):
            m = cast(dict[str, object], moment) if isinstance(moment, dict) else {}
            url, heading = m.get("url"), m.get("moment")
            if not isinstance(url, str) or not (
                heading is None or isinstance(heading, str)
            ):
                raise EvalError(f"{where}: each relevant moment needs url and moment")
            keys.add(_key(url, heading))
        queries.append(Query(query.strip(), frozenset(keys)))
    return QuerySet(queries, [str(u) for u in cast(list[object], distractors)])


def rank_score(
    ranked: list[list[str]], relevant: list[set[str]], k: int = K
) -> tuple[float, float]:
    """Recall@k (share of relevant moments in the top k, averaged over queries) and
    mean reciprocal rank of the first relevant moment."""
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
    urls = {key[0] for q in queries for key in q.relevant} | set(labelled.distractors)
    for url in sorted(urls):
        item_id = store.tags.find(url)
        item = store.tags.input(item_id) if item_id is not None else None
        if item is None:
            raise EvalError(f"item {url} is not in this database")
        embedded = embed_item(gateway, model, item, skip=set())
        cost += embedded.cost_usd
        if embedded.refused is not None:
            raise EvalError(f"the {embedded.refused.scope} AI budget is spent today")
        for moment in item.moments:
            if moment.id not in embedded.vectors:
                continue
            key = _pool_key(_key(url, moment.heading))
            if key in pool:
                raise EvalError(f"two moments of {url} share a heading: {key}")
            pool[key] = embedded.vectors[moment.id]
    relevant = [{_pool_key(key) for key in q.relevant} for q in queries]
    unknown = sorted({key for keys in relevant for key in keys} - set(pool))
    if unknown:
        raise EvalError(f"labelled moments not in the stored text: {unknown}")
    if len(pool) < min_pool:
        raise EvalError(
            f"the pool has {len(pool)} moments; add distractors to reach {min_pool}"
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
