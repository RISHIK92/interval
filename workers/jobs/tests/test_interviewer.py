"""P5-W33 (§6.2, AI-1, OPS-4; Q-P5-13): the interviewer answers a player's question in
an AI-league battle from the problem's notes, through the gateway, within budget."""

from collections.abc import Generator
from contextlib import contextmanager
from decimal import Decimal

import psycopg
import pytest

from interval_db.generated import AiProvider
from interval_db.messages import AnswerInterviewer
from interval_jobs.adapters.memory import InMemoryAi, InMemoryStore, StoredUser
from interval_jobs.adapters.memory_queue import InMemoryQueue
from interval_jobs.adapters.postgres import PostgresInterviewer
from interval_jobs.adapters.trafilatura_extractor import TrafilaturaExtractor
from interval_jobs.ai.gateway import AiGateway
from interval_jobs.pipeline import ModelJob, Pipeline, StageServices
from interval_jobs.ports import (
    Completion,
    Delivery,
    InterviewerAsk,
    Message,
    ModelError,
    Usage,
)
from interval_jobs.queue import ATTEMPTS

from .test_db_guards import a_user
from .test_pipeline import NOW, web
from .test_tagging_decide import NearWal

ASK = InterviewerAsk(
    "u1",
    "Can a key's value be null?",
    "# A cache\nKeep the latest values.",
    "Values are never null: a put with null is an error.",
)


class Interviewer:
    provider: AiProvider = "openrouter"

    def __init__(self, reply: str = "No: putting a null value is an error.") -> None:
        self.reply = reply
        self.prompts: list[list[Message]] = []

    def complete(self, model: str, messages: list[Message]) -> Completion:
        self.prompts.append(messages)
        return Completion(self.reply, 400, 20, Decimal("0.0001"))


def world(
    llm: Interviewer, spent: Decimal = Decimal(0), model: bool = True
) -> tuple[InMemoryStore, Pipeline]:
    store = InMemoryStore()
    store.users.rows["u1"] = StoredUser("u1", is_anonymous=False, email="u1@x.test")
    store.interviewer.pending[7] = ASK
    ledger = InMemoryAi(store.users)
    if spent:
        ledger.record(
            Usage("u1", "interviewer", "openrouter", "m", 1, 1, spent, occurred_at=NOW)
        )

    @contextmanager
    def gateway() -> Generator[AiGateway]:
        yield AiGateway(ledger, llm, NearWal(), clock=lambda: NOW)

    @contextmanager
    def unit() -> Generator[StageServices]:
        yield StageServices(store, web(), TrafilaturaExtractor())

    pipeline = Pipeline(
        unit,
        InMemoryQueue(),
        questions=ModelJob("batch:qmodel", gateway) if model else None,
    )
    return store, pipeline


def ask(pipeline: Pipeline) -> None:
    pipeline.handlers()["answer_interviewer"](
        AnswerInterviewer(question_id=7),
        Delivery(attempt=1, idempotency_key="interviewer-7"),
    )


def test_a_question_is_answered_from_the_notes_once() -> None:
    llm = Interviewer()
    store, pipeline = world(llm)
    ask(pipeline)
    assert store.interviewer.saved[7] == (
        "No: putting a null value is an error.",
        "qmodel",
    )
    # The notes stay in the system message, told never to solve; the question comes
    # alone, fenced as data.
    sent = llm.prompts[0]
    assert "never write code" in sent[0]["content"].lower()
    assert ASK.notes in sent[0]["content"]
    assert sent[1]["content"] == f"<question>\n{ASK.question}\n</question>"
    assert ASK.notes not in sent[1]["content"]
    ask(pipeline)  # a redelivery: answered already, not asked again
    assert len(llm.prompts) == 1


def test_over_budget_or_no_model_is_unanswered_not_waiting() -> None:
    store, pipeline = world(Interviewer(), spent=Decimal(5))
    ask(pipeline)
    assert store.interviewer.saved[7] == (None, None)
    store, pipeline = world(Interviewer(), model=False)
    ask(pipeline)
    assert store.interviewer.saved[7] == (None, None)


def test_postgres_answers_a_pending_question_once(conn: psycopg.Connection) -> None:
    a_user(conn, "iq1")
    conn.execute(
        "insert into lld_problem (slug, title, difficulty, statement, interface, "
        "limits, visible, private_key, content_hash, league, interviewer_notes) "
        "values ('iq-cache', 'A cache', 'easy', '# A cache', '{}', '{}', '[]', "
        "%s, %s, 'ai', 'Values are never null.') on conflict do nothing",
        (f"lld/problems/iq-cache/{'d' * 64}.json", "d" * 64),
    )
    match = conn.execute(
        "insert into game_match (server_id, mode, problem_slug, league) "
        "values (0, 'battle', 'iq-cache', 'ai') returning id"
    ).fetchone()
    assert match is not None
    row = conn.execute(
        "insert into battle_question (match_id, user_id, question) "
        "values (%s, 'iq1', 'Null?') returning id",
        (match[0],),
    ).fetchone()
    assert row is not None
    store = PostgresInterviewer(conn)
    got = store.to_answer(int(row[0]))
    assert got == InterviewerAsk("iq1", "Null?", "# A cache", "Values are never null.")
    store.save(int(row[0]), "No.", "qmodel")
    store.save(int(row[0]), None, None)  # a redelivery changes nothing
    assert store.to_answer(int(row[0])) is None
    assert conn.execute(
        "select status, answer, model from battle_question where id = %s", (row[0],)
    ).fetchone() == ("answered", "No.", "qmodel")


class Failing(Interviewer):
    def complete(self, model: str, messages: list[Message]) -> Completion:
        raise ModelError("openrouter: 503")


def test_a_failing_model_is_retried_then_shown_unanswered() -> None:
    store, pipeline = world(Failing())
    for attempt in range(1, ATTEMPTS + 1):
        with pytest.raises(ModelError):
            pipeline.handlers()["answer_interviewer"](
                AnswerInterviewer(question_id=7),
                Delivery(attempt=attempt, idempotency_key="interviewer-7"),
            )
        # Waiting until the queue's last try; then said unanswered.
        assert (7 in store.interviewer.saved) == (attempt == ATTEMPTS)
    assert store.interviewer.saved[7] == (None, None)


def test_an_answer_quoting_the_notes_or_empty_is_withheld() -> None:
    store, pipeline = world(Interviewer(f"Sure, the notes say: {ASK.notes}"))
    ask(pipeline)
    assert store.interviewer.saved[7] == (None, None)
    store, pipeline = world(Interviewer("   "))
    ask(pipeline)
    assert store.interviewer.saved[7] == (None, None)
