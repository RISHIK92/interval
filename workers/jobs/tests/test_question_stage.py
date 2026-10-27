"""The question stage (Q-1, Q-P2-10, P2-W8-S01): tagging queues a tagged moment's
questions; the model drafts them once; a rate limit, a model error or a broken reply
waits 5 minutes and tries again, never giving up and never raising."""

import json
import re
import threading
from collections.abc import Generator
from contextlib import contextmanager
from decimal import Decimal

from interval_db.generated import AiProvider
from interval_jobs.adapters.memory import InMemoryAi, InMemoryStore
from interval_jobs.ai.gateway import AiGateway
from interval_jobs.concepts.graph import parse_concepts
from interval_jobs.concepts.sync import sync_concepts
from interval_jobs.pipeline import ModelJob
from interval_jobs.ports import Completion, Message, ModelError

from .test_pipeline import NOW, NoEmbeddings, World

# Tags the item and its first moment, so that moment is a question target.
TAGS = (
    '{"item": {"difficulty": "intermediate", "concepts": ["write-ahead-log"]},'
    ' "moments": [{"ordinal": 0, "difficulty": "beginner",'
    ' "concepts": ["write-ahead-log"]}]}'
)


class QuestionLlm:
    """Tags like the tagging model; drafts questions quoting the passage it was given,
    or fails as told."""

    provider: AiProvider = "openrouter"

    def __init__(self) -> None:
        self.question_calls = 0
        self.fail: str | None = None  # "error" or "garbage"

    def complete(self, model: str, messages: list[Message]) -> Completion:
        if "multiple-choice" not in messages[0]["content"]:
            return Completion(TAGS, 800, 60, Decimal(0))
        self.question_calls += 1
        if self.fail == "error":
            raise ModelError("openrouter free: 429 rate limited")
        if self.fail == "garbage":
            return Completion("I can't do JSON today", 500, 10, Decimal(0))
        passage = (
            messages[1]["content"].split("<passage>\n", 1)[1].split("\n</passage>")[0]
        )
        quote = re.split(r"(?<=[.!?])\s", passage.strip())[0][:200]
        one = {
            "stem": "What does the passage say?",
            "options": ["It", "Something else", "Nothing", "Everything"],
            "correct": 0,
            "citation": quote,
        }
        return Completion(
            json.dumps({"questions": [one, {**one, "stem": "And again?"}]}),
            500,
            200,
            Decimal(0),
        )


def question_world(questions: bool = True) -> tuple[World, QuestionLlm]:
    llm = QuestionLlm()
    ledger = InMemoryAi(InMemoryStore().users)

    @contextmanager
    def gateway() -> Generator[AiGateway]:
        yield AiGateway(ledger, llm, NoEmbeddings(), clock=lambda: NOW)

    world = World(
        tagging=ModelJob("small-model", gateway),
        questions=ModelJob("nemotron-free", gateway) if questions else None,
    )
    sync_concepts(
        world.store,
        parse_concepts(
            "version: 1\nconcepts:\n"
            "  - {slug: write-ahead-log, name: WAL, topic: databases}\n",
            "c.yaml",
        ),
    )
    return world, llm


def deliver_questions_once(world: World) -> None:
    """One pass over what is waiting now; World.run would chase retries forever."""
    handler = world.pipeline.handlers()["generate_questions"]
    for _ in range(world.queue.pending("generate_questions")):
        world.queue.consume_one("generate_questions", handler, threading.Event())


def test_tagging_queues_a_tagged_moments_questions_and_they_are_drafted_once() -> None:
    world, llm = question_world()
    world.discover()
    world.run()
    saved = world.store.questions.rows
    assert saved and all(q.status == "pending" for q in saved)
    assert {q.concepts for q in saved} == {("write-ahead-log",)}
    assert all(q.model == "nemotron-free" for q in saved)
    drafted = llm.question_calls
    assert drafted == len({q.moment_id for q in saved})
    # Queued again (a re-tag, a backfill): same text, same prompt, no new call.
    for moment_id in {q.moment_id for q in saved}:
        world.queue.enqueue(
            "generate_questions",
            {"moment_id": moment_id, "attempt": 0, "broken": 0},
            idempotency_key=f"again-{moment_id}",
        )
    world.run()
    assert llm.question_calls == drafted


def test_a_failure_waits_five_minutes_and_tries_again_without_raising() -> None:
    world, llm = question_world()
    llm.fail = "error"
    world.discover()
    world.run_except("generate_questions")
    waiting = world.queue.pending("generate_questions")
    assert waiting > 0
    deliver_questions_once(world)
    # Re-enqueued, not failed: the queue's own retries would give up.
    assert world.queue.failed_messages("generate_questions") == []
    assert world.queue.pending_delays("generate_questions") == [300] * waiting
    assert all(
        message["attempt"] == 1
        for _, message in world.queue.pending_messages("generate_questions")
    )
    assert world.store.questions.rows == []
    # A broken reply is a failure too; the next success is saved.
    llm.fail = "garbage"
    deliver_questions_once(world)
    assert world.store.questions.rows == []
    llm.fail = None
    deliver_questions_once(world)
    assert world.store.questions.rows
    assert world.queue.pending("generate_questions") == 0


def test_without_a_question_model_nothing_is_queued() -> None:
    world, _ = question_world(questions=False)
    world.discover()
    world.run()
    assert world.queue.pending("generate_questions") == 0


def test_one_retry_chain_per_moment_and_broken_replies_stop_after_five() -> None:
    world, llm = question_world()
    llm.fail = "garbage"
    world.discover()
    world.run_except("generate_questions")
    deliver_questions_once(world)
    moments = {
        m["moment_id"] for _, m in world.queue.pending_messages("generate_questions")
    }
    calls = llm.question_calls
    # A backfill while each retry waits starts a second chain: dropped, no call.
    for moment_id in moments:
        world.queue.enqueue(
            "generate_questions",
            {"moment_id": moment_id, "attempt": 0, "broken": 0},
            idempotency_key=f"backfill-{moment_id}",
        )
    deliver_questions_once(world)
    assert llm.question_calls == calls + len(moments)  # only the real retries ran
    for _ in range(10):
        deliver_questions_once(world)
    # Five broken replies each, then it gives up: nothing waits, nothing is saved.
    assert world.queue.pending("generate_questions") == 0
    assert llm.question_calls == 5 * len(moments)
    assert world.store.questions.retries == {}


def test_a_moment_whose_rights_were_lowered_is_not_sent_to_the_model() -> None:
    world, llm = question_world()
    world.discover()
    world.run_except("generate_questions")
    world.store.sources.set_moments_enabled(world.source_id, False)
    deliver_questions_once(world)
    assert llm.question_calls == 0


def test_a_redraft_retires_the_old_questions_instead_of_deleting_them() -> None:
    world, _ = question_world()
    world.discover()
    world.run()
    first = {q.id for q in world.store.questions.rows}
    moment_id = world.store.questions.rows[0].moment_id
    # An admin's correction changes the concepts, so the hash: drafted again.
    item_id = next(m.item_id for m in world.store.moments.rows if m.id == moment_id)
    world.store.tags.moment_concept_overrides[(item_id, "x")] = frozenset()
    world.store.questions.rows[0].content_hash = "stale"
    world.queue.enqueue(
        "generate_questions",
        {"moment_id": moment_id, "attempt": 0, "broken": 0},
        idempotency_key="redraft",
    )
    world.run()
    retired = {q.id for q in world.store.questions.rows if q.status == "retired"}
    assert retired and retired <= first
    assert any(q.id not in first for q in world.store.questions.rows)
