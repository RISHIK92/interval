"""Drafting candidate concepts for the owner (Q-P1-03): one gateway call, the answer
validated against the loaded graph, written to a file for review, never loaded."""

from datetime import UTC, datetime
from decimal import Decimal

import pytest

from interval_db.generated import AiProvider
from interval_jobs.adapters.memory import InMemoryAi, InMemoryStore
from interval_jobs.ai.gateway import AiGateway
from interval_jobs.concepts.draft import DraftError, draft_concepts
from interval_jobs.concepts.graph import parse_concepts
from interval_jobs.ports import Completion, Embeddings, Message, Usage

NOW = datetime(2026, 10, 26, 12, tzinfo=UTC)

EXISTING = parse_concepts(
    """version: 3
concepts:
  - {slug: replication, name: Replication, topic: distributed-systems}
  - {slug: indexes, name: Indexes, topic: databases}
""",
    "concepts.yaml",
)


class ScriptedLlm:
    provider: AiProvider = "openrouter"

    def __init__(self, answer: str) -> None:
        self.answer = answer
        self.prompts: list[list[Message]] = []

    def complete(self, model: str, messages: list[Message]) -> Completion:
        self.prompts.append(messages)
        return Completion(self.answer, 500, 300, Decimal("0.01"))


class NoEmbeddings:
    provider: AiProvider = "voyage"

    def embed(self, model: str, texts: list[str]) -> Embeddings:
        raise AssertionError("drafting never embeds")


def gateway(llm: ScriptedLlm) -> AiGateway:
    return AiGateway(InMemoryAi(InMemoryStore().users), llm, NoEmbeddings())


GOOD = """```yaml
- slug: replication-lag
  name: Replication lag
  topic: distributed-systems
  description: How far a follower trails its leader.
  prerequisites: [replication]
- slug: replication
  name: Replication again
  topic: distributed-systems
```"""


def test_candidates_are_validated_and_existing_slugs_are_dropped() -> None:
    llm = ScriptedLlm(GOOD)
    text = draft_concepts(gateway(llm), EXISTING, "distributed-systems", 10, "m")
    assert "DRAFT" in text.splitlines()[0]
    assert "replication-lag" in text
    assert "Replication again" not in text  # already in the graph
    # The model saw the existing slugs, so it can link to them.
    assert "replication" in llm.prompts[0][-1]["content"]


def test_a_candidate_linking_to_an_unknown_concept_fails_the_draft() -> None:
    bad = GOOD.replace("prerequisites: [replication]", "prerequisites: [nowhere]")
    with pytest.raises(DraftError, match="nowhere"):
        draft_concepts(
            gateway(ScriptedLlm(bad)), EXISTING, "distributed-systems", 10, "m"
        )


def test_an_answer_that_is_not_a_yaml_list_fails_the_draft() -> None:
    with pytest.raises(DraftError, match="list"):
        draft_concepts(
            gateway(ScriptedLlm("Sure! Here are some ideas.")),
            EXISTING,
            "databases",
            5,
            "m",
        )


def test_an_unknown_topic_is_refused_before_any_call() -> None:
    llm = ScriptedLlm(GOOD)
    with pytest.raises(DraftError, match="topic"):
        draft_concepts(gateway(llm), EXISTING, "cooking", 5, "m")
    assert llm.prompts == []


def test_a_slug_that_is_not_text_fails_the_draft_cleanly() -> None:
    odd = "- {slug: [not, text], name: X, topic: databases}"
    with pytest.raises(DraftError):
        draft_concepts(gateway(ScriptedLlm(odd)), EXISTING, "databases", 5, "m")


def test_prose_around_the_fenced_yaml_is_ignored() -> None:
    chatty = "Here you go:\n" + GOOD + "\nHope this helps."
    text = draft_concepts(gateway(ScriptedLlm(chatty)), EXISTING, "databases", 5, "m")
    assert "replication-lag" in text


def test_a_spent_budget_fails_the_draft_without_a_call() -> None:
    llm = ScriptedLlm(GOOD)
    ledger = InMemoryAi(InMemoryStore().users)
    spent = Usage(None, "concept_drafting", "openrouter", "m", 0, 0, Decimal(100), NOW)
    ledger.record(spent)  # far past the global daily budget
    with pytest.raises(DraftError, match="budget"):
        draft_concepts(
            AiGateway(ledger, llm, NoEmbeddings(), clock=lambda: NOW),
            EXISTING,
            "databases",
            5,
            "m",
        )
    assert llm.prompts == []
