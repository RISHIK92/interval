"""Asking a decision model about a moment's shortlisted concepts (tagging v3,
2026-10-27): one call per moment whose content changed, a yes/no question per
candidate plus one difficulty question, and one title/summary pass per article."""

from decimal import Decimal

from interval_db.generated import AiProvider
from interval_jobs.adapters.memory import InMemoryAi, InMemoryStore
from interval_jobs.ai.gateway import AiGateway, OverBudget
from interval_jobs.ports import (
    Decision,
    DecisionState,
    EmbeddingPurpose,
    Embeddings,
    NoulAnswer,
    ScoreAnswer,
)
from interval_jobs.tagging_decide import DecidePass, content_hash, decide

from .test_tagging import GRAPH, ScriptedLlm, item

VECTORS = {
    "write-ahead-log": [1.0, 0.0, 0.0],
    "transactions": [0.0, 1.0, 0.0],
    "replication": [0.0, 0.0, 1.0],
}


class NearWal:
    provider: AiProvider = "voyage"

    def __init__(self) -> None:
        self.texts: list[str] = []

    def embed(
        self, model: str, texts: list[str], purpose: EmbeddingPurpose
    ) -> Embeddings:
        self.texts.extend(texts)
        return Embeddings([[1.0, 0.2, 0.0] for _ in texts], 10, Decimal("0.00001"))


class Decider:
    provider: AiProvider = "openrouter"

    def __init__(self) -> None:
        self.asked: list[tuple[DecisionState, dict[str, object]]] = []

    def decide(
        self, model: str, state: DecisionState, questions: dict[str, object]
    ) -> Decision:
        self.asked.append((state, questions))
        answers: dict[str, NoulAnswer | ScoreAnswer] = {
            slug: NoulAnswer(0.9 if slug == "write-ahead-log" else 0.1)
            for slug in questions
            if slug != "difficulty"
        }
        answers["difficulty"] = ScoreAnswer(1.2)
        return Decision(answers, 300, 0, Decimal("0.000006"))  # type: ignore[arg-type]


def gateway(
    decider: Decider, voyage: NearWal, store: InMemoryStore | None = None
) -> AiGateway:
    users = (store or InMemoryStore()).users
    return AiGateway(InMemoryAi(users), ScriptedLlm({}), voyage, decisions=decider)


def run(
    decider: Decider, known: dict[int, str] | None = None, known_item: str | None = None
) -> DecidePass | OverBudget:
    return decide(
        gateway(decider, NearWal()),
        "pplx",
        "voyage-x",
        item(),
        GRAPH,
        VECTORS,
        known or {},
        known_item,
        size=2,
    )


def test_each_moment_gets_yes_no_questions_for_its_shortlist_and_a_difficulty() -> None:
    decider = Decider()
    result = run(decider)
    assert isinstance(result, DecidePass)
    assert len(decider.asked) == 4  # three moments and the title pass
    state, questions = decider.asked[1]
    assert state["section"] == "Why a log"
    assert set(questions) == {"write-ahead-log", "transactions", "difficulty"}
    wal = questions["write-ahead-log"]
    assert isinstance(wal, dict) and wal["type"] == "noul"
    answer = result.moments[11]
    assert answer.probabilities == {"write-ahead-log": 0.9, "transactions": 0.1}
    assert answer.difficulty == 1.2
    assert answer.content_hash == content_hash(
        "Writes go to the log first.", 1, "voyage-x", 2
    )
    assert result.current == frozenset({10, 11, 12})
    assert result.item is not None and result.item.difficulty == 1.2
    assert result.cost_usd > 0


def test_unchanged_moments_and_an_unchanged_title_are_not_asked_again() -> None:
    first = run(Decider())
    assert isinstance(first, DecidePass)
    known = {m: a.content_hash for m, a in first.moments.items()}
    assert first.item is not None
    decider = Decider()
    again = run(decider, known, first.item.content_hash)
    assert isinstance(again, DecidePass)
    assert decider.asked == [] and again.moments == {} and again.item is None
    assert again.current == frozenset({10, 11, 12})  # still the item's moments


def test_only_the_moment_whose_text_changed_is_asked_again() -> None:
    first = run(Decider())
    assert isinstance(first, DecidePass) and first.item is not None
    known = {m: a.content_hash for m, a in first.moments.items()}
    known[11] = "an older text's hash"
    decider = Decider()
    again = run(decider, known, first.item.content_hash)
    assert isinstance(again, DecidePass)
    assert len(decider.asked) == 1 and set(again.moments) == {11}


def test_the_hash_changes_with_the_shortlists_model_size_or_graph() -> None:
    base = content_hash("text", 1, "voyage-x", 15)
    assert (
        len(
            {
                base,
                content_hash("text", 2, "voyage-x", 15),
                content_hash("text", 1, "voyage-y", 15),
                content_hash("text", 1, "voyage-x", 20),
            }
        )
        == 4
    )


def test_answers_paid_for_are_kept_when_the_model_fails_part_way() -> None:
    class FailsThird(Decider):
        def decide(
            self, model: str, state: DecisionState, questions: dict[str, object]
        ) -> Decision:
            if len(self.asked) == 2:
                self.asked.append((state, questions))
                return Decision({}, 300, 0, Decimal("0.000006"))  # no answers
            return super().decide(model, state, questions)

    result = run(FailsThird())
    assert isinstance(result, DecidePass)
    assert set(result.moments) == {10, 11}
    assert result.stopped is not None and "missing" in result.stopped


def test_a_spent_budget_stops_before_asking() -> None:
    store = InMemoryStore()
    ledger = InMemoryAi(store.users)
    from datetime import UTC, datetime

    from interval_jobs.ports import Usage

    ledger.record(
        Usage(
            None, "tagging", "openrouter", "m", 1, 0, Decimal("10"), datetime.now(UTC)
        )
    )
    decider = Decider()
    result = decide(
        AiGateway(ledger, ScriptedLlm({}), NearWal(), decisions=decider),
        "pplx",
        "voyage-x",
        item(),
        GRAPH,
        VECTORS,
        {},
        None,
        size=2,
    )
    assert isinstance(result, DecidePass)
    assert isinstance(result.refused, OverBudget)
    assert decider.asked == [] and result.moments == {}


def test_a_moment_with_no_text_is_neither_embedded_nor_asked() -> None:
    # Voyage answers 400 to an empty input, which failed the whole item's tagging.
    voyage, decider = NearWal(), Decider()
    empty = "Intro paragraph about logs.\nWhy a log\nRecovery\nReplay the log.\n"
    result = decide(
        gateway(decider, voyage),
        "pplx",
        "voyage-x",
        item(full_text=empty),
        GRAPH,
        VECTORS,
        {},
        None,
        size=2,
    )
    assert isinstance(result, DecidePass)
    assert all(text.strip() for text in voyage.texts)
    assert set(result.moments) == {10, 12}
    assert result.current == frozenset({10, 12})
