"""Embeddings per moment (DB-3, AI-4, P1-W3-S04): one batch per item through the
gateway, only for moments whose text is stored (full-text rights)."""

from decimal import Decimal

from interval_db.generated import AiProvider
from interval_jobs.adapters.memory import InMemoryAi, InMemoryStore
from interval_jobs.ai.gateway import AiGateway, OverBudget
from interval_jobs.embedding import BATCH, embed_item
from interval_jobs.ports import (
    Completion,
    EmbeddingPurpose,
    Embeddings,
    Message,
    TagInput,
    TagMoment,
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


def item(moments: list[TagMoment], text: str | None = TEXT) -> TagInput:
    return TagInput("T", None, text, None, moments, None, False)


def test_each_moment_with_text_gets_a_document_vector() -> None:
    voyage = FakeVoyage()
    gateway = AiGateway(InMemoryAi(InMemoryStore().users), NoLlm(), voyage)
    moments = [
        TagMoment(1, 0, None),
        TagMoment(2, 1, "Why a log"),
        TagMoment(3, 2, "Gone"),
    ]
    got = embed_item(gateway, "voyage-3.5", item(moments), skip=set())
    assert got.refused is None
    assert set(got.vectors) == {1, 2}  # "Gone" isn't in the text: nothing to embed
    assert voyage.batches[0] == (
        ["Intro.", "Writes first.\nRecovery\nReplay."],
        "document",
    )


def test_no_stored_text_means_no_call() -> None:
    voyage = FakeVoyage()
    gateway = AiGateway(InMemoryAi(InMemoryStore().users), NoLlm(), voyage)
    got = embed_item(gateway, "voyage-3.5", item([TagMoment(1, 0, None)], None), set())
    assert got.vectors == {}
    assert voyage.batches == []


def test_many_moments_go_in_batches() -> None:
    voyage = FakeVoyage()
    gateway = AiGateway(InMemoryAi(InMemoryStore().users), NoLlm(), voyage)
    lines = ["intro"] + [line for i in range(BATCH + 3) for line in (f"H{i}", f"b{i}")]
    moments = [TagMoment(0, 0, None)] + [
        TagMoment(i + 1, i + 1, f"H{i}") for i in range(BATCH + 3)
    ]
    got = embed_item(gateway, "voyage-3.5", item(moments, "\n".join(lines)), set())
    assert len(got.vectors) == BATCH + 4
    assert got.cost_usd == Decimal("0.0002")
    assert [len(b[0]) for b in voyage.batches] == [BATCH, 4]


def test_moments_already_embedded_are_skipped() -> None:
    voyage = FakeVoyage()
    gateway = AiGateway(InMemoryAi(InMemoryStore().users), NoLlm(), voyage)
    moments = [TagMoment(1, 0, None), TagMoment(2, 1, "Why a log")]
    got = embed_item(gateway, "voyage-3.5", item(moments), skip={1})
    assert set(got.vectors) == {2}
    assert voyage.batches[0][0] == ["Writes first.\nRecovery\nReplay."]


class MeteredEmbeddings(FakeVoyage):
    # Voyage is never budgeted (owner, 2026-10-28); a metered provider still is.
    provider: AiProvider = "openrouter"


def test_a_budget_stop_keeps_the_batches_already_paid_for() -> None:
    voyage = MeteredEmbeddings(cost=Decimal(6))  # one batch spends the $5 budget
    gateway = AiGateway(InMemoryAi(InMemoryStore().users), NoLlm(), voyage)
    lines = ["intro"] + [line for i in range(BATCH + 3) for line in (f"H{i}", f"b{i}")]
    moments = [TagMoment(0, 0, None)] + [
        TagMoment(i + 1, i + 1, f"H{i}") for i in range(BATCH + 3)
    ]
    got = embed_item(gateway, "voyage-3.5", item(moments, "\n".join(lines)), set())
    assert got.refused == OverBudget("global")
    assert len(got.vectors) == BATCH


def test_voyage_embeds_every_batch_past_the_budget() -> None:
    voyage = FakeVoyage(cost=Decimal(6))
    gateway = AiGateway(InMemoryAi(InMemoryStore().users), NoLlm(), voyage)
    lines = ["intro"] + [line for i in range(BATCH + 3) for line in (f"H{i}", f"b{i}")]
    moments = [TagMoment(0, 0, None)] + [
        TagMoment(i + 1, i + 1, f"H{i}") for i in range(BATCH + 3)
    ]
    got = embed_item(gateway, "voyage-3.5", item(moments, "\n".join(lines)), set())
    assert got.refused is None
    assert len(got.vectors) == len(moments)
