"""A book chapter's checkpoint, made on demand (§5F, Q-P2-35, P2-W11-S06), on fakes:
the W3 tagger on its sessions, then the W8 generator and blind validator, every call
on the book owner's budget."""

from collections.abc import Generator
from contextlib import contextmanager
from decimal import Decimal

import pytest

from interval_db.messages import BookCheckpoint
from interval_jobs.adapters.memory import (
    InMemoryAi,
    InMemoryStore,
    StoredBook,
    StoredCheckpoint,
    StoredUser,
)
from interval_jobs.adapters.memory_queue import InMemoryQueue
from interval_jobs.adapters.trafilatura_extractor import TrafilaturaExtractor
from interval_jobs.ai.gateway import AiGateway
from interval_jobs.books.checkpoint import (
    GAVE_UP,
    MAX_SESSIONS,
    NO_QUESTIONS,
    NOT_CONFIGURED,
    OVER_BUDGET,
    spread,
)
from interval_jobs.pipeline import ModelJob, Pipeline, StageServices
from interval_jobs.ports import (
    BookChapterRow,
    BookSessionRow,
    Completion,
    Delivery,
    Message,
    ModelError,
    Usage,
)
from interval_jobs.queue import ATTEMPTS

from .test_pipeline import NOW, web
from .test_question_stage import QuestionLlm
from .test_tagging import GRAPH
from .test_tagging_decide import VECTORS, Decider, NearWal

CHAPTER = 7


def sessions(count: int) -> list[BookSessionRow]:
    return [
        BookSessionRow(
            f"Logs {n}",
            f"Writes go to the log first, part {n}. The log is replayed after a crash.",
            4,
            n,
            n,
        )
        for n in range(1, count + 1)
    ]


class Counting(QuestionLlm):
    """Drafts and validates as the question stage's fake; records every prompt."""

    def __init__(self) -> None:
        super().__init__()
        self.passages: list[str] = []

    def complete(self, model: str, messages: list[Message]) -> Completion:
        self.passages.append(messages[1]["content"])
        return super().complete(model, messages)


def world(
    count: int = 2, llm: Counting | None = None, spent: Decimal = Decimal(0)
) -> tuple[InMemoryStore, Pipeline, Counting, InMemoryAi]:
    store = InMemoryStore()
    store.users.rows["u1"] = StoredUser("u1", is_anonymous=False, email="u1@x.test")
    store.concepts.apply(GRAPH)
    for slug, vector in VECTORS.items():
        store.concepts.save_vector(slug, "voyage-x", "h", vector)
    store.books.rows[1] = StoredBook(
        user_id="u1",
        file_key="books/u1/x.pdf",
        title="Designing Data Systems",
        status="ready",
        chapters=[BookChapterRow("Storage", sessions(count))],
    )
    store.books.checkpoints[CHAPTER] = StoredCheckpoint(book_id=1, index=0)
    llm = llm or Counting()
    ledger = InMemoryAi(store.users)
    if spent:
        ledger.record(
            Usage("u1", "questions", "openrouter", "m", 1, 1, spent, occurred_at=NOW)
        )
    decider = Decider()

    @contextmanager
    def gateway() -> Generator[AiGateway]:
        yield AiGateway(ledger, llm, NearWal(), clock=lambda: NOW, decisions=decider)

    @contextmanager
    def unit() -> Generator[StageServices]:
        yield StageServices(store, web(), TrafilaturaExtractor())

    pipeline = Pipeline(
        unit,
        InMemoryQueue(),
        tagging=ModelJob("decisions:pplx", gateway),
        embedding=ModelJob("voyage-x", gateway),
        questions=ModelJob("batch:qmodel", gateway),
    )
    return store, pipeline, llm, ledger


def run(pipeline: Pipeline, attempt: int = 1) -> None:
    pipeline.handlers()["book_checkpoint"](
        BookCheckpoint(chapter_id=CHAPTER),
        Delivery(attempt=attempt, idempotency_key=f"book-checkpoint-{CHAPTER}-1"),
    )


def test_a_chapter_gets_tagged_live_questions_and_is_ready() -> None:
    store, pipeline, llm, ledger = world()
    run(pipeline)
    checkpoint = store.books.checkpoints[CHAPTER]
    assert (checkpoint.status, checkpoint.failure) == ("ready", None)
    # The tagger's answer (WAL at 0.9 in both sessions) is the chapter's concept.
    assert checkpoint.concepts == frozenset({"write-ahead-log"})
    assert len(checkpoint.questions) == 4  # two drafts from each session
    assert all(q.live for q in checkpoint.questions)
    assert {q.concepts for q in checkpoint.questions} == {
        frozenset({"write-ahead-log"})
    }
    # Every call is the owner's (OPS-4); the batch tier isn't used on demand.
    assert ledger.rows and {u.user_id for u in ledger.rows} == {"u1"}
    assert {u.model for u in ledger.rows if u.feature == "questions"} == {"qmodel"}
    assert any("Concepts the passage teaches: WAL" in p for p in llm.passages)


def test_a_question_the_validator_answers_differently_is_rejected() -> None:
    llm = Counting()
    llm.validator_wrong = True
    store, pipeline, _, _ = world(llm=llm)
    run(pipeline)
    checkpoint = store.books.checkpoints[CHAPTER]
    assert not any(q.live for q in checkpoint.questions)
    assert (checkpoint.status, checkpoint.failure) == ("failed", NO_QUESTIONS)


def test_over_budget_fails_it_with_that_reason() -> None:
    store, pipeline, _, _ = world(spent=Decimal("5"))
    run(pipeline)
    checkpoint = store.books.checkpoints[CHAPTER]
    assert (checkpoint.status, checkpoint.failure) == ("failed", OVER_BUDGET)


def test_a_model_error_is_retried_and_given_up_on_the_last_attempt() -> None:
    llm = Counting()
    llm.fail = "error"
    store, pipeline, _, _ = world(llm=llm)
    with pytest.raises(ModelError):
        run(pipeline)
    assert store.books.checkpoints[CHAPTER].status == "preparing"
    run(pipeline, attempt=ATTEMPTS)
    checkpoint = store.books.checkpoints[CHAPTER]
    assert (checkpoint.status, checkpoint.failure) == ("failed", GAVE_UP)


def test_a_checkpoint_not_being_prepared_is_left_alone() -> None:
    store, pipeline, llm, ledger = world()
    store.books.checkpoints[CHAPTER].status = "ready"
    run(pipeline)
    assert ledger.rows == [] and llm.passages == []
    # Nor while the book isn't ready.
    store.books.checkpoints[CHAPTER].status = "preparing"
    store.books.rows[1].status = "ocr"
    run(pipeline)
    assert ledger.rows == []


def test_a_long_chapter_sends_at_most_six_sessions_spread_through_it() -> None:
    store, pipeline, llm, _ = world(count=20)
    run(pipeline)
    drafted = [p for p in llm.passages if p.startswith("Concepts the passage")]
    assert len(drafted) == MAX_SESSIONS
    assert "part 1." in drafted[0] and "part 20." in drafted[-1]
    assert spread(20, 6) == [0, 4, 8, 11, 15, 19]
    assert spread(3, 6) == [0, 1, 2]
    assert len(store.books.checkpoints[CHAPTER].questions) == 2 * MAX_SESSIONS


def test_without_the_models_it_fails_at_once_with_that_reason() -> None:
    store, _, _, _ = world()

    @contextmanager
    def unit() -> Generator[StageServices]:
        yield StageServices(store, web(), TrafilaturaExtractor())

    run(Pipeline(unit, InMemoryQueue()))
    checkpoint = store.books.checkpoints[CHAPTER]
    assert (checkpoint.status, checkpoint.failure) == ("failed", NOT_CONFIGURED)
