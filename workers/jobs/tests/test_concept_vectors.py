"""Concept vectors for the tagging shortlist (2026-10-27): each active concept's
"name: description" embedded once per model, again only when that text changes."""

from decimal import Decimal

from interval_db.generated import AiProvider
from interval_jobs.adapters.memory import InMemoryAi, InMemoryStore
from interval_jobs.ai.gateway import AiGateway
from interval_jobs.concept_vectors import concept_text, embed_concepts
from interval_jobs.concepts.graph import parse_concepts
from interval_jobs.concepts.sync import sync_concepts
from interval_jobs.ports import EmbeddingPurpose, Embeddings, ModelError

from .test_ai_gateway import FakeLlm

GRAPH = """version: 1
concepts:
  - {slug: wal, name: Write-ahead log, topic: databases, description: Log first.}
  - {slug: raft, name: Raft, topic: distributed-systems}
  - {slug: old, name: Old, topic: backend, retired: true}
"""


class CountingVoyage:
    provider: AiProvider = "voyage"

    def __init__(self) -> None:
        self.texts: list[str] = []

    def embed(
        self, model: str, texts: list[str], purpose: EmbeddingPurpose
    ) -> Embeddings:
        assert purpose == "document"
        self.texts.extend(texts)
        return Embeddings([[1.0] * 1024 for _ in texts], 10, Decimal("0.0001"))


def test_active_concepts_are_embedded_once_and_again_only_when_their_text_changes() -> (
    None
):
    store = InMemoryStore()
    sync_concepts(store, parse_concepts(GRAPH, "c.yaml"))
    voyage = CountingVoyage()
    gateway = AiGateway(InMemoryAi(store.users), FakeLlm(), voyage)
    assert embed_concepts(gateway, store, "voyage-x").embedded == 2
    assert voyage.texts == ["Write-ahead log: Log first.", "Raft"]
    assert embed_concepts(gateway, store, "voyage-x").embedded == 0
    sync_concepts(
        store,
        parse_concepts(
            GRAPH.replace("version: 1", "version: 2").replace(
                "Log first.", "Logged first."
            ),
            "c.yaml",
        ),
    )
    assert embed_concepts(gateway, store, "voyage-x").embedded == 1
    assert voyage.texts[-1] == "Write-ahead log: Logged first."
    assert concept_text("Raft", None) == "Raft"


def many(n: int) -> str:
    return "version: 1\nconcepts:\n" + "".join(
        f"  - {{slug: c{i}, name: C{i}, topic: backend}}\n" for i in range(n)
    )


def test_concepts_are_embedded_in_batches_and_a_stop_keeps_what_was_paid() -> None:
    store = InMemoryStore()
    sync_concepts(store, parse_concepts(many(70), "c.yaml"))

    class StopsSecond(CountingVoyage):
        def embed(
            self, model: str, texts: list[str], purpose: EmbeddingPurpose
        ) -> Embeddings:
            if self.texts:
                raise ModelError("voyage down")
            return super().embed(model, texts, purpose)

    voyage = StopsSecond()
    gateway = AiGateway(InMemoryAi(store.users), FakeLlm(), voyage)
    done = embed_concepts(gateway, store, "voyage-x")
    assert done.embedded == 64 and done.failed == "voyage down"
    assert len(store.concepts.vectors("voyage-x")) == 64
