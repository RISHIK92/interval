"""Why-this-matters notes (§5E, REC-5, AI-1, AI-3, Q-P1-18, P1-W4-S06): a template per
top ranking signal, built only from the source's name and the user's choices, and a
one-time polish by the notes model that sees nothing of the article but its title."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from interval_db.generated import AiProvider, Topic
from interval_jobs.adapters.memory import InMemoryAi, InMemoryStore
from interval_jobs.ai.gateway import AiGateway, OverBudget
from interval_jobs.feed.notes import note_for, polish_note
from interval_jobs.ports import (
    Completion,
    EmbeddingPurpose,
    Embeddings,
    EntryFacts,
    Message,
    NoteInput,
    NoteKey,
    Usage,
)
from interval_jobs.ranking.scoring import Scored

NOW = datetime(2026, 10, 26, 12, tzinfo=UTC)
FACTS = EntryFacts(
    moment_id=7,
    item_id=70,
    source_id=700,
    minutes=5,
    difficulty="intermediate",
    published_at=NOW,
    quality=5,
    concepts=frozenset(),
    topics=frozenset({"backend", "distributed-systems"}),
    source_name="Martin Fowler",
)


ALL = ("topic_match", "level_fit", "quality", "freshness", "time_fit")


def scored(signal: str, facts: EntryFacts = FACTS) -> Scored:
    # The other signals follow in a fixed order, as the fallback reads them.
    order = (signal, *(s for s in ALL if s != signal))
    return Scored(7, 70, 700, 1.0, signal, facts, order)


def note(s: Scored, topics: list[Topic] | None = None) -> tuple[NoteKey, str] | None:
    return note_for(
        s, topics or ["databases", "distributed-systems"], "intermediate", "3-8", NOW
    )


@pytest.mark.parametrize(
    ("signal", "variant", "text"),
    [
        (
            "topic_match",
            "distributed-systems",
            "On distributed systems, a topic you chose.",
        ),
        ("level_fit", "", "Pitched at your intermediate level."),
        ("quality", "", "From Martin Fowler, one of the most trusted sources here."),
        ("freshness", "", "New this week."),
        ("time_fit", "3-8", "Sized for your 3\u20138 min break."),
    ],
)
def test_each_signal_has_its_template(signal: str, variant: str, text: str) -> None:
    # The user chose databases first, but the item matches distributed systems.
    assert note(scored(signal)) == (NoteKey(70, signal, "intermediate", variant), text)


# Owner, 2026-10-26: a note that wouldn't be true gives way to the next signal's.
@pytest.mark.parametrize(
    ("signal", "facts", "fallback"),
    [
        (
            "freshness",
            replace(FACTS, published_at=NOW - timedelta(days=8)),
            "topic_match",
        ),
        ("freshness", replace(FACTS, published_at=None), "topic_match"),
        ("topic_match", replace(FACTS, topics=frozenset({"backend"})), "level_fit"),
        ("level_fit", replace(FACTS, difficulty="advanced"), "topic_match"),
        ("level_fit", replace(FACTS, difficulty=None), "topic_match"),
        ("quality", replace(FACTS, quality=3), "topic_match"),
        ("time_fit", replace(FACTS, minutes=12), "topic_match"),
        ("time_fit", replace(FACTS, minutes=None), "topic_match"),
    ],
)
def test_a_note_that_would_not_be_true_falls_to_the_next_signal(
    signal: str, facts: EntryFacts, fallback: str
) -> None:
    got = note(scored(signal, facts))
    assert got is not None and got[0].signal == fallback


def test_no_note_when_nothing_true_can_be_said() -> None:
    nothing = replace(
        FACTS,
        topics=frozenset(),
        difficulty=None,
        quality=None,
        published_at=None,
        minutes=None,
    )
    assert note(scored("topic_match", nothing)) is None


class NoteLlm:
    provider: AiProvider = "openrouter"

    def __init__(self, reply: str) -> None:
        self.reply = reply
        self.prompts: list[list[Message]] = []

    def complete(self, model: str, messages: list[Message]) -> Completion:
        self.prompts.append(messages)
        return Completion(self.reply, 120, 20, Decimal("0.0001"))


class NoEmbeddings:
    provider: AiProvider = "voyage"

    def embed(
        self, model: str, texts: list[str], purpose: EmbeddingPurpose
    ) -> Embeddings:
        raise AssertionError("notes never embed")


NOTE = NoteInput(
    note_id=1,
    title="Patterns of Distributed Systems",
    source_name="Martin Fowler",
    text="On distributed systems, a topic you chose.",
)


def gateway(llm: NoteLlm, spent: Decimal = Decimal(0)) -> AiGateway:
    ledger = InMemoryAi(InMemoryStore().users)
    if spent:
        ledger.record(Usage(None, "notes", "openrouter", "m", 0, 0, spent, NOW))
    return AiGateway(ledger, llm, NoEmbeddings(), clock=lambda: NOW)


def test_the_model_sees_only_the_title_source_and_template() -> None:
    llm = NoteLlm("Distributed systems you chose, explained by Martin Fowler.")
    assert polish_note(gateway(llm), "small", NOTE) == (
        "Distributed systems you chose, explained by Martin Fowler."
    )
    (prompt,) = llm.prompts
    assert prompt[-1]["content"] == (
        "Title: Patterns of Distributed Systems\n"
        "Source: Martin Fowler\n"
        "Note: On distributed systems, a topic you chose."
    )


@pytest.mark.parametrize("reply", ["", "Line one.\nLine two.", "x" * 161])
def test_a_reply_that_isnt_one_short_sentence_keeps_the_template(reply: str) -> None:
    assert polish_note(gateway(NoteLlm(reply)), "small", NOTE) is None


def test_over_budget_makes_no_call() -> None:
    llm = NoteLlm("unused")
    result = polish_note(gateway(llm, spent=Decimal(1000)), "small", NOTE)
    assert isinstance(result, OverBudget)
    assert llm.prompts == []
