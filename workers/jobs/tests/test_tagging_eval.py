"""The tagging eval (AI-5, P1-W3-S02): owner-labelled articles scored against the
model's tags (ADR-0058: tagged whole); a prompt or model change must pass before it
ships."""

from decimal import Decimal

import pytest

from interval_db.generated import AiProvider, RightsProfile
from interval_jobs.adapters.memory import InMemoryAi, InMemoryStore
from interval_jobs.ai.gateway import AiGateway
from interval_jobs.concept_vectors import text_hash
from interval_jobs.concepts.graph import parse_concepts
from interval_jobs.concepts.sync import sync_concepts
from interval_jobs.ports import EmbeddingPurpose, Embeddings, FeedEntry, Tags
from interval_jobs.tagging_eval import (
    EvalError,
    Label,
    parse_labels,
    run_eval,
    run_shortlist_eval,
    score,
)

from .test_tagging import NoEmbeddings, ScriptedLlm

URL = "https://s.test/p"
OTHER = "https://s.test/q"
LABELS = f"""version: 1
moments:
  - {{url: "{URL}", moment: null, difficulty: beginner, concepts: [a, b]}}
  - {{url: "{URL}", moment: "Why  a log", difficulty: advanced, concepts: [c]}}
  - {{url: "{OTHER}", difficulty: intermediate, concepts: [d]}}
"""


def test_labels_are_read_merged_per_article_and_checked() -> None:
    labels = parse_labels(LABELS, "labels.yaml")
    # A moment-era file's two sections of one article: their concepts together, at
    # the lower of their two levels.
    assert labels == [
        Label(URL, "beginner", frozenset({"a", "b", "c"})),
        Label(OTHER, "intermediate", frozenset({"d"})),
    ]
    three = LABELS + f'  - {{url: "{URL}", difficulty: advanced, concepts: []}}\n'
    assert parse_labels(three, "l.yaml")[0].difficulty == "advanced"
    with pytest.raises(EvalError, match="difficulty"):
        parse_labels(LABELS.replace("advanced", "expert"), "labels.yaml")


def test_scores_are_micro_averaged_over_every_labelled_article() -> None:
    labels = parse_labels(LABELS, "labels.yaml")
    # URL: 2 right, 1 wrong, 1 missed, right level. OTHER: right concept, wrong level.
    predicted = {
        URL: Tags("beginner", frozenset({"a", "c", "x"})),
        OTHER: Tags("advanced", frozenset({"d"})),
    }
    report = score(labels, predicted, min_f1=0.6, min_difficulty=0.5)
    assert (report.precision, report.recall) == (3 / 4, 3 / 4)
    assert report.difficulty_accuracy == 0.5
    assert report.articles == 2
    assert report.passed


def test_an_article_the_model_skipped_counts_as_all_missed() -> None:
    labels = parse_labels(LABELS, "labels.yaml")
    report = score(labels, {}, min_f1=0.1, min_difficulty=0.1)
    assert (report.recall, report.f1, report.passed) == (0.0, 0.0, False)


def article(store: InMemoryStore, text: str) -> int:
    profile: RightsProfile = "full_text_internal"
    sid = store.sources.upsert(
        name="s", feed_url="https://s.test/f", rights_profile=profile, homepage=None
    )
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
    store.items.store_full_text(item, text)
    return item


def test_the_eval_tags_through_the_gateway_and_stores_nothing() -> None:
    store = InMemoryStore()
    sync_concepts(
        store,
        parse_concepts(
            "version: 1\nconcepts:\n"
            "  - {slug: a, name: A, topic: backend}\n"
            "  - {slug: c, name: C, topic: backend}\n",
            "c.yaml",
        ),
    )
    item = article(store, "intro\nH\nbody")
    answer = {"item": {"difficulty": "beginner", "concepts": ["a", "c"]}}
    gateway = AiGateway(InMemoryAi(store.users), ScriptedLlm(answer), NoEmbeddings())
    labels = [Label(URL, "beginner", frozenset({"a", "c"}))]
    report = run_eval(gateway, "m", store, labels)
    assert (report.f1, report.difficulty_accuracy, report.passed) == (1.0, 1.0, True)
    assert report.cost_usd == Decimal("0.002")
    assert store.tags.version(item) is None


class FlatVoyage:
    """Every text lands on the first axis: only text hits and the cap tell articles
    apart."""

    provider: AiProvider = "voyage"

    def embed(
        self, model: str, texts: list[str], purpose: EmbeddingPurpose
    ) -> Embeddings:
        return Embeddings([[1.0, 0.0] for _ in texts], 10, Decimal("0.0001"))


def test_shortlist_recall_is_measured_per_variant_and_size() -> None:
    store = InMemoryStore()
    sync_concepts(
        store,
        parse_concepts(
            "version: 1\nconcepts:\n"
            "  - {slug: a, name: Alpha, topic: backend}\n"
            "  - {slug: c, name: Gamma, topic: backend, aliases: [gam]}\n",
            "c.yaml",
        ),
    )
    store.concepts.save_vector("a", "v", text_hash("Alpha"), [1.0, 0.0])
    store.concepts.save_vector("c", "v", text_hash("Gamma"), [0.0, 1.0])
    article(store, "intro\nH\nthe gam part")
    gateway = AiGateway(InMemoryAi(store.users), ScriptedLlm({}), FlatVoyage())
    labels = [Label(URL, "beginner", frozenset({"a", "c"}))]
    report = run_shortlist_eval(gateway, "v", store, labels, sizes=(1, 2))
    # Embeddings alone, one candidate: "a"; "c" is missed.
    assert report.recall["embeddings"] == {1: 0.5, 2: 1.0}
    # The alias "gam" in the article's text puts "c" first.
    assert report.recall["embeddings+aliases"] == {1: 0.5, 2: 1.0}
    assert report.articles == 1
    assert report.mean_text_hits == 1.0
    # A concept without a current vector, or a label naming no concept, is refused.
    with pytest.raises(EvalError, match="unknown concept"):
        run_shortlist_eval(
            gateway, "v", store, [Label(URL, "beginner", frozenset({"zz"}))]
        )
    store.concepts.save_vector("c", "v", "stale", [0.0, 1.0])
    with pytest.raises(EvalError, match="embed-concepts"):
        run_shortlist_eval(gateway, "v", store, labels, sizes=(1,))


def test_a_decision_model_is_asked_once_stored_and_swept_over_cut_offs() -> None:
    from .test_tagging_decide import Decider, NearWal

    store = InMemoryStore()
    sync_concepts(
        store,
        parse_concepts(
            "version: 1\nconcepts:\n"
            "  - {slug: write-ahead-log, name: Write-ahead log, topic: databases}\n"
            "  - {slug: transactions, name: Transactions, topic: databases}\n",
            "c.yaml",
        ),
    )
    store.concepts.save_vector(
        "write-ahead-log", "v", text_hash("Write-ahead log"), [1.0, 0.0, 0.0]
    )
    store.concepts.save_vector(
        "transactions", "v", text_hash("Transactions"), [0.0, 1.0, 0.0]
    )
    article(store, "intro\nH\nbody")
    decider = Decider()
    gateway = AiGateway(
        InMemoryAi(store.users), ScriptedLlm({}), NearWal(), decisions=decider
    )
    labels = [Label(URL, "intermediate", frozenset({"write-ahead-log"}))]
    first = run_eval(gateway, "decisions:pplx", store, labels, embedding_model="v")
    assert (first.precision, first.recall, first.difficulty_accuracy) == (1.0, 1.0, 1.0)
    assert len(first.sweep) == 6
    assert len(decider.asked) == 1  # the article, whole
    # A second run reads the stored answers: free, and the same scores.
    again = run_eval(gateway, "decisions:pplx", store, labels, embedding_model="v")
    assert len(decider.asked) == 1
    assert again.f1 == first.f1 and again.cost_usd == 0
    with pytest.raises(EvalError, match="embedding model"):
        run_eval(gateway, "decisions:pplx", store, labels)
