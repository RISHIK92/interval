"""Asking a decision model about a text's shortlisted concepts (tagging v3,
2026-10-27): a yes/no question per candidate plus one difficulty question. An article
is asked once, whole (ADR-0058); a book chapter once per session and once for its
title."""

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
    TagInput,
    TagMoment,
)
from interval_jobs.tagging import MOMENT_CHARS
from interval_jobs.tagging_decide import DecidePass, article_text, content_hash, decide

from .test_tagging import GRAPH, SECTIONS, TEXT, ScriptedLlm, item

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


def chapter(full_text: str = TEXT, sessions: list[TagMoment] | None = None) -> TagInput:
    """A book chapter as the checkpoint builds it: its sessions as sections."""
    return TagInput(
        "Chapter 1", "A book", full_text, None, sessions or SECTIONS, None, False
    )


def run(
    decider: Decider, known_item: str | None = None, text: TagInput | None = None
) -> DecidePass | OverBudget:
    return decide(
        gateway(decider, NearWal()),
        "pplx",
        "voyage-x",
        text or item(),
        GRAPH,
        VECTORS,
        known_item,
        size=2,
    )


def test_an_article_is_asked_once_about_its_title_summary_and_text() -> None:
    decider = Decider()
    result = run(decider)
    assert isinstance(result, DecidePass)
    assert len(decider.asked) == 1 and result.moments == {}
    state, questions = decider.asked[0]
    text = state["text"]
    assert text == article_text(item())
    assert isinstance(text, str) and "Replay the log after a crash." in text
    assert "A tour of the write-ahead log." in text
    assert set(questions) == {"write-ahead-log", "transactions", "difficulty"}
    assert result.item is not None and result.item.difficulty == 1.2
    assert result.item.probabilities == {"write-ahead-log": 0.9, "transactions": 0.1}
    assert result.cost_usd > 0


def test_the_article_pass_reads_full_text_else_its_excerpt() -> None:
    text = item()
    assert article_text(text) == "\n".join(
        ["How our WAL works", "A tour of the write-ahead log.", TEXT]
    )
    excerpt = item(None, excerpt="Logs first.")
    assert article_text(excerpt).endswith("Logs first.")
    assert len(article_text(item("x" * (MOMENT_CHARS * 2)))) == MOMENT_CHARS


def test_an_unchanged_article_is_not_asked_again() -> None:
    first = run(Decider())
    assert isinstance(first, DecidePass) and first.item is not None
    decider = Decider()
    again = run(decider, first.item.content_hash)
    assert isinstance(again, DecidePass)
    assert decider.asked == [] and again.item is None


def test_each_session_of_a_chapter_gets_its_own_questions() -> None:
    decider = Decider()
    result = run(decider, text=chapter())
    assert isinstance(result, DecidePass)
    assert len(decider.asked) == 4  # three sessions and the title pass
    state, questions = decider.asked[1]
    assert state["section"] == "Why a log"
    assert set(questions) == {"write-ahead-log", "transactions", "difficulty"}
    wal = questions["write-ahead-log"]
    assert isinstance(wal, dict) and wal["type"] == "noul"
    answer = result.moments[11]
    assert answer.probabilities == {"write-ahead-log": 0.9, "transactions": 0.1}
    assert answer.content_hash == content_hash(
        "Writes go to the log first.", 1, "voyage-x", 2
    )
    # The title pass of a chapter reads its title and summary, not its sessions.
    assert decider.asked[3][0]["text"] == "Chapter 1\nA book"


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

    result = run(FailsThird(), text=chapter())
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
        None,
        size=2,
    )
    assert isinstance(result, DecidePass)
    assert isinstance(result.refused, OverBudget)
    assert decider.asked == [] and result.item is None


def test_a_session_with_no_text_is_neither_embedded_nor_asked() -> None:
    # Voyage answers 400 to an empty input, which failed the whole item's tagging.
    voyage, decider = NearWal(), Decider()
    empty = "Intro paragraph about logs.\nWhy a log\nRecovery\nReplay the log.\n"
    result = decide(
        gateway(decider, voyage),
        "pplx",
        "voyage-x",
        chapter(empty),
        GRAPH,
        VECTORS,
        None,
        size=2,
    )
    assert isinstance(result, DecidePass)
    assert all(text.strip() for text in voyage.texts)
    assert set(result.moments) == {10, 12}


def test_a_session_is_cut_to_moment_chars() -> None:
    voyage, decider = NearWal(), Decider()
    long = "Intro paragraph about logs. " + "x" * MOMENT_CHARS + "\n"
    result = decide(
        gateway(decider, voyage),
        "pplx",
        "voyage-x",
        chapter(long, [TagMoment(id=10, ordinal=0, heading=None)]),
        GRAPH,
        VECTORS,
        None,
        size=1,
    )
    assert isinstance(result, DecidePass)
    assert len(voyage.texts) == 2  # the session, cut to MOMENT_CHARS, and the title
    assert len(voyage.texts[0]) == MOMENT_CHARS
