"""Tagging with a decision model (TypeSafe's Jev on OpenRouter's Decisions API): one
typed request per section, concepts from the choice's probabilities, difficulty from
an ordered score; the item's tags come from its sections (2026-10-27)."""

from datetime import UTC, datetime
from decimal import Decimal

import pytest

from interval_db.generated import AiProvider
from interval_jobs.adapters.memory import InMemoryAi, InMemoryStore
from interval_jobs.ai.gateway import AiGateway, OverBudget
from interval_jobs.ports import (
    ChoiceAnswer,
    Decision,
    DecisionState,
    ScoreAnswer,
    Usage,
)
from interval_jobs.tagging import Tagged, TaggingError, tag_item

from .test_tagging import GRAPH, NoEmbeddings, ScriptedLlm, item

MODEL = "decisions:typesafe/jev-1.14"


class FakeDecisions:
    provider: AiProvider = "openrouter"

    def __init__(self, answers: list[tuple[dict[str, float], float]]) -> None:
        self.answers = answers  # per call: (concept probabilities, difficulty score)
        self.requests: list[tuple[str, DecisionState, dict[str, object]]] = []

    def decide(
        self, model: str, state: DecisionState, questions: dict[str, object]
    ) -> Decision:
        self.requests.append((model, state, questions))
        probabilities, score = self.answers[len(self.requests) - 1]
        top = max(probabilities, key=lambda k: probabilities[k])
        return Decision(
            {
                "concepts": ChoiceAnswer(top, probabilities),
                "difficulty": ScoreAnswer(score),
            },
            input_tokens=500,
            output_tokens=0,
            cost_usd=Decimal("0.00002"),
        )


def gateway(decisions: FakeDecisions, ledger: InMemoryAi | None = None) -> AiGateway:
    return AiGateway(
        ledger or InMemoryAi(InMemoryStore().users),
        ScriptedLlm({}),
        NoEmbeddings(),
        decisions=decisions,
    )


def tagged(result: Tagged | OverBudget) -> Tagged:
    assert isinstance(result, Tagged)
    return result


# Probabilities well above or below the cut-off (MIN_PROBABILITY), so the tests hold
# when it is retuned.
THREE = [
    ({"write-ahead-log": 0.7, "transactions": 0.29, "replication": 0.001}, 0.2),
    ({"transactions": 0.5, "write-ahead-log": 0.499, "replication": 0.001}, 1.0),
    ({"replication": 0.999, "write-ahead-log": 0.001}, 1.7),
]


def test_each_section_is_one_typed_request_over_the_concept_list() -> None:
    fake = FakeDecisions(THREE)
    tag_item(gateway(fake), MODEL, item(), GRAPH)
    assert len(fake.requests) == 3
    model, state, questions = fake.requests[1]
    assert model == "typesafe/jev-1.14"
    assert isinstance(state, dict) and state["section"] == "Why a log"
    assert "Writes go to the log first." in str(state["text"])
    concepts = questions["concepts"]
    assert isinstance(concepts, dict) and concepts["type"] == "choice"
    assert concepts["criteria"] == {
        "write-ahead-log": "WAL",
        "transactions": "Transactions",
        "replication": "Replication",
    }
    difficulty = questions["difficulty"]
    assert isinstance(difficulty, dict) and difficulty["type"] == "score"
    assert len(difficulty["criteria"]) == 3  # type: ignore[arg-type]


def test_concepts_above_the_threshold_most_likely_first_and_difficulty_rounded() -> (
    None
):
    result = tagged(tag_item(gateway(FakeDecisions(THREE)), MODEL, item(), GRAPH))
    moments = result.result.moments
    assert moments[10].concepts == frozenset({"write-ahead-log", "transactions"})
    assert moments[10].difficulty == "beginner"
    assert moments[11].concepts == frozenset({"transactions", "write-ahead-log"})
    assert moments[11].difficulty == "intermediate"
    assert moments[12].concepts == frozenset({"replication"})
    assert moments[12].difficulty == "advanced"


def test_a_flat_distribution_still_keeps_its_top_concept_and_drops_unknowns() -> None:
    flat = [({"made-up": 0.98, "replication": 0.012, "transactions": 0.008}, 1.0)] * 3
    result = tagged(tag_item(gateway(FakeDecisions(flat)), MODEL, item(), GRAPH))
    assert result.result.moments[10].concepts == frozenset({"replication"})


def test_the_items_tags_come_from_its_sections() -> None:
    result = tagged(tag_item(gateway(FakeDecisions(THREE)), MODEL, item(), GRAPH))
    whole = result.result.item
    assert whole.concepts == frozenset(
        {"write-ahead-log", "replication", "transactions"}
    )
    assert whole.difficulty == "intermediate"  # mean of 0.2, 1.0, 1.7 rounds to 1
    assert result.cost_usd == Decimal("0.00006")


def test_an_item_without_sections_is_one_request_on_its_excerpt() -> None:
    fake = FakeDecisions([({"transactions": 0.8, "replication": 0.2}, 0.0)])
    result = tagged(
        tag_item(
            gateway(fake), MODEL, item(full_text=None, excerpt="About txns."), GRAPH
        )
    )
    assert len(fake.requests) == 1
    assert "About txns." in str(fake.requests[0][1])
    assert result.result.moments == {}
    assert result.result.item.concepts == frozenset({"transactions", "replication"})


def test_over_budget_stops_and_says_so() -> None:
    ledger = InMemoryAi(InMemoryStore().users)
    # Today's offline budget already spent.
    ledger.record(
        Usage(
            user_id=None,
            feature="tagging",
            provider="openrouter",
            model="m",
            input_tokens=1,
            output_tokens=0,
            cost_usd=Decimal("10"),
            occurred_at=datetime.now(UTC),
        )
    )
    fake = FakeDecisions(THREE)
    result = tag_item(gateway(fake, ledger), MODEL, item(), GRAPH)
    assert isinstance(result, OverBudget)
    assert fake.requests == []


def test_an_items_concept_needs_the_cut_off_on_average_not_in_total() -> None:
    # 0.02 in every section is below the per-section cut-off however many sections
    # there are; summed, it would pass on a long enough article (review, 2026-10-27).
    faint = [
        ({"write-ahead-log": 0.9, "transactions": 0.08, "replication": 0.02}, 1.0)
    ] * 3
    whole = tagged(tag_item(gateway(FakeDecisions(faint)), MODEL, item(), GRAPH))
    assert whole.result.item.concepts == frozenset({"write-ahead-log", "transactions"})


def test_a_decision_missing_an_answer_is_an_error_so_the_stage_retries() -> None:
    class NoDifficulty(FakeDecisions):
        def decide(
            self, model: str, state: DecisionState, questions: dict[str, object]
        ) -> Decision:
            full = super().decide(model, state, questions)
            return Decision(
                {"concepts": full.answers["concepts"]},
                full.input_tokens,
                full.output_tokens,
                full.cost_usd,
            )

    with pytest.raises(TaggingError, match="difficulty"):
        tag_item(gateway(NoDifficulty(THREE)), MODEL, item(), GRAPH)


def test_a_half_way_score_rounds_up() -> None:
    halves = [
        ({"write-ahead-log": 1.0}, 0.5),
        ({"write-ahead-log": 1.0}, 1.5),
        ({"write-ahead-log": 1.0}, 0.0),
    ]
    moments = tagged(
        tag_item(gateway(FakeDecisions(halves)), MODEL, item(), GRAPH)
    ).result.moments
    assert (moments[10].difficulty, moments[11].difficulty) == (
        "intermediate",
        "advanced",
    )
