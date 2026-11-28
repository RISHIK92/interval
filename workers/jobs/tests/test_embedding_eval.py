"""The embeddings eval (ADR-0007, Q-P1-27, P1-W3-S04): owner queries with their
relevant articles (one vector each, ADR-0058); a candidate Voyage model is scored on
recall and cost."""

from decimal import Decimal

import pytest

from interval_db.generated import AiProvider
from interval_jobs.adapters.memory import InMemoryAi, InMemoryStore
from interval_jobs.ai.gateway import AiGateway
from interval_jobs.embedding_eval import EvalError, parse_queries, rank_score, run_eval
from interval_jobs.ports import (
    Completion,
    EmbeddingPurpose,
    Embeddings,
    FeedEntry,
    Message,
)

LOG = "https://s.test/log"
CRASH = "https://s.test/crash"
INTRO = "https://s.test/intro"
QUERIES = f"""version: 1
queries:
  - query: why write the log first
    relevant: [{{url: "{LOG}", moment: Why a log}}]
  - query: what happens after a crash
    relevant: [{{url: "{CRASH}"}}]
distractors: ["{INTRO}"]
"""


def test_queries_are_read_and_checked() -> None:
    queries = parse_queries(QUERIES, "q.yaml")
    assert queries.distractors == [INTRO]
    assert [q.query for q in queries.queries] == [
        "why write the log first",
        "what happens after a crash",
    ]
    # A moment-era entry's heading no longer counts: the article is the unit.
    assert queries.queries[0].relevant == frozenset({LOG})
    with pytest.raises(EvalError, match="relevant"):
        parse_queries("version: 1\nqueries:\n  - {query: x, relevant: []}\n", "q.yaml")


def test_recall_at_five_and_reciprocal_rank() -> None:
    ranked = [["a", "b", "c"], ["x", "y", "z", "w", "v", "target"]]
    relevant = [{"b"}, {"target"}]
    recall, mrr = rank_score(ranked, relevant, k=5)
    assert recall == 0.5  # found in the top 5 for the first query only
    assert mrr == pytest.approx((1 / 2 + 1 / 6) / 2)


class KeywordVoyage:
    """Vectors from keywords, so nearness is predictable."""

    provider: AiProvider = "voyage"
    WORDS = ("log", "crash", "intro")

    def embed(
        self, model: str, texts: list[str], purpose: EmbeddingPurpose
    ) -> Embeddings:
        vectors = [
            [float(word in t.lower()) for word in self.WORDS] + [0.0] * 1021
            for t in texts
        ]
        return Embeddings(vectors, 4, Decimal("0.001"))


class NoLlm:
    provider: AiProvider = "openrouter"

    def complete(self, model: str, messages: list[Message]) -> Completion:
        raise AssertionError("no completions")


def stocked() -> tuple[InMemoryStore, AiGateway]:
    store = InMemoryStore()
    sid = store.sources.upsert(
        name="s",
        feed_url="https://s.test/f",
        rights_profile="full_text_internal",
        homepage=None,
    )
    for url, text in (
        (LOG, "the log comes first"),
        (CRASH, "after a crash"),
        (INTRO, "intro text"),
    ):
        entry = FeedEntry(
            guid=url,
            link=url,
            title="T",
            author=None,
            published_at=None,
            updated_at=None,
            summary=None,
        )
        item = store.items.upsert_from_feed(sid, entry, keep_excerpt=False)
        store.items.store_full_text(item, text)
    return store, AiGateway(InMemoryAi(store.users), NoLlm(), KeywordVoyage())


def test_the_eval_ranks_the_pool_of_articles_and_stores_nothing() -> None:
    store, gateway = stocked()
    queries = parse_queries(QUERIES, "q.yaml")
    report = run_eval(gateway, "voyage-3.5", store, queries, min_pool=3)
    # Each query's own article ranks first: a broken ranking would fail this.
    assert (report.queries, report.pool, report.mrr) == (2, 3, 1.0)
    # One call per article, one for the queries.
    assert report.cost_usd == Decimal("0.004")
    assert all(store.embeddings.missing(i, "voyage-3.5") for i in store.items.rows)


def test_a_pool_too_small_to_tell_models_apart_is_refused() -> None:
    store, gateway = stocked()
    with pytest.raises(EvalError, match="distractors"):
        run_eval(gateway, "voyage-3.5", store, parse_queries(QUERIES, "q.yaml"))


def test_a_labelled_article_missing_from_the_database_is_an_error() -> None:
    store, gateway = stocked()
    typo = parse_queries(QUERIES.replace(CRASH, CRASH + "x"), "q")
    with pytest.raises(EvalError, match="not in this database"):
        run_eval(gateway, "voyage-3.5", store, typo, min_pool=3)
