"""One embedding per article (DB-3, AI-4, P1-W3-S04, ADR-0058): its stored full text,
cut to TEXT_CHARS, in one call through the gateway; nothing without stored text."""

from datetime import UTC, datetime
from decimal import Decimal

from interval_db.generated import AiProvider
from interval_jobs.adapters.memory import InMemoryAi, InMemoryStore
from interval_jobs.ai.gateway import AiGateway, OverBudget
from interval_jobs.embedding import TEXT_CHARS, embed_item
from interval_jobs.ports import (
    Completion,
    EmbeddingPurpose,
    Embeddings,
    Message,
    TagInput,
    Usage,
)

TEXT = "Intro.\nWhy a log\nWrites first.\nRecovery\nReplay.\n"


class FakeVoyage:
    provider: AiProvider = "voyage"

    def __init__(self, cost: Decimal = Decimal("0.0001")) -> None:
        self.batches: list[tuple[list[str], EmbeddingPurpose]] = []
        self._cost = cost

    def embed(
        self, model: str, texts: list[str], purpose: EmbeddingPurpose
    ) -> Embeddings:
        self.batches.append((texts, purpose))
        return Embeddings(
            [[float(len(t))] + [0.0] * 1023 for t in texts], 10, self._cost
        )


class NoLlm:
    provider: AiProvider = "openrouter"

    def complete(self, model: str, messages: list[Message]) -> Completion:
        raise AssertionError("embedding never completes")


def item(text: str | None = TEXT, excerpt: str | None = None) -> TagInput:
    return TagInput("T", None, text, excerpt, [], None, False)


def test_an_article_gets_one_document_vector_of_its_whole_text() -> None:
    voyage = FakeVoyage()
    gateway = AiGateway(InMemoryAi(InMemoryStore().users), NoLlm(), voyage)
    got = embed_item(gateway, "voyage-3.5", item())
    assert got.refused is None and got.vector is not None
    assert got.cost_usd == Decimal("0.0001")
    assert voyage.batches == [([TEXT.strip()], "document")]


def test_a_long_article_is_cut_not_refused() -> None:
    voyage = FakeVoyage()
    gateway = AiGateway(InMemoryAi(InMemoryStore().users), NoLlm(), voyage)
    embed_item(gateway, "voyage-3.5", item("x" * (TEXT_CHARS + 50)))
    assert voyage.batches[0][0] == ["x" * TEXT_CHARS]


def test_no_stored_text_means_no_call_even_with_an_excerpt() -> None:
    voyage = FakeVoyage()
    gateway = AiGateway(InMemoryAi(InMemoryStore().users), NoLlm(), voyage)
    got = embed_item(gateway, "voyage-3.5", item(None, excerpt="An excerpt."))
    assert got.vector is None and got.refused is None
    assert voyage.batches == []


class MeteredEmbeddings(FakeVoyage):
    # Voyage is never budgeted (owner, 2026-10-28); a metered provider still is.
    provider: AiProvider = "openrouter"


def spent_ledger() -> InMemoryAi:
    ledger = InMemoryAi(InMemoryStore().users)
    ledger.record(
        Usage(
            None,
            "embeddings",
            "openrouter",
            "m",
            0,
            0,
            Decimal(1000),
            datetime.now(UTC),
        )
    )
    return ledger


def test_a_spent_budget_refuses_and_embeds_nothing() -> None:
    voyage = MeteredEmbeddings()
    gateway = AiGateway(spent_ledger(), NoLlm(), voyage)
    got = embed_item(gateway, "voyage-3.5", item())
    assert got.refused == OverBudget("global")
    assert got.vector is None and voyage.batches == []


def test_voyage_embeds_past_the_budget() -> None:
    voyage = FakeVoyage()
    gateway = AiGateway(spent_ledger(), NoLlm(), voyage)
    got = embed_item(gateway, "voyage-3.5", item())
    assert got.refused is None and got.vector is not None
