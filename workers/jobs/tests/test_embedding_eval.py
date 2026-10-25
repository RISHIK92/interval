"""The embeddings eval (ADR-0007, Q-P1-27, P1-W3-S04): owner queries with their
relevant moments; a candidate Voyage model is scored on recall and cost."""

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
    MomentRow,
)

URL = "https://s.test/p"
QUERIES = f"""version: 1
queries:
  - query: why write the log first
    relevant: [{{url: "{URL}", moment: Why a log}}]
  - query: what happens after a crash
    relevant: [{{url: "{URL}", moment: Recovery}}]
"""


def test_queries_are_read_and_checked() -> None:
    queries = parse_queries(QUERIES + "distractors: [https://other.test/x]\n", "q.yaml")
    assert queries.distractors == ["https://other.test/x"]
    assert [q.query for q in queries.queries] == [
        "why write the log first",
        "what happens after a crash",
    ]
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
    store.sources.set_moments_enabled(sid, True)
    entry = FeedEntry(
        guid="g",
        link=URL,
        title="T",
        author=None,
        published_at=None,
        updated_at=None,
        summary=None,
    )
    item = store.items.upsert_from_feed(sid, entry, keep_excerpt=False)
    store.items.store_full_text(
        item, "intro text\nWhy a log\nthe log comes first\nRecovery\nafter a crash"
    )
    store.moments.replace(
        item,
        [
            MomentRow(0, "T", 1, URL, "page_top"),
            MomentRow(1, "Why a log", 1, f"{URL}#a", "anchor"),
            MomentRow(2, "Recovery", 1, f"{URL}#b", "anchor"),
        ],
    )
    return store, AiGateway(InMemoryAi(store.users), NoLlm(), KeywordVoyage())


def test_the_eval_ranks_the_pool_and_stores_nothing() -> None:
    store, gateway = stocked()
    queries = parse_queries(QUERIES, "q.yaml")
    report = run_eval(gateway, "voyage-3.5", store, queries, min_pool=3)
    # Each query's own moment ranks first: a broken ranking would fail this.
    assert (report.queries, report.pool, report.mrr) == (2, 3, 1.0)
    assert report.cost_usd == Decimal("0.002")  # one pool call, one query call
    assert all(store.embeddings.missing(i, "voyage-3.5") for i in store.items.rows)


def test_a_pool_too_small_to_tell_models_apart_is_refused() -> None:
    store, gateway = stocked()
    with pytest.raises(EvalError, match="distractors"):
        run_eval(gateway, "voyage-3.5", store, parse_queries(QUERIES, "q.yaml"))


def test_a_labelled_moment_missing_from_the_text_is_an_error_not_a_miss() -> None:
    store, gateway = stocked()
    typo = parse_queries(QUERIES.replace("moment: Recovery", "moment: Recovry"), "q")
    with pytest.raises(EvalError, match="not in the stored text"):
        run_eval(gateway, "voyage-3.5", store, typo, min_pool=3)
