"""Question drafting and validation through a batch API (Q-P2-13, P2-W8-S05): submit
what needs doing, collect it later at half price. A fake batch client plays the
provider; the store is the in-memory one, tagged by the pipeline."""

import json
import re
from collections.abc import Callable, Generator, Sequence
from contextlib import AbstractContextManager, contextmanager
from datetime import timedelta
from decimal import Decimal

import pytest

from interval_db.generated import AiProvider
from interval_jobs.adapters.memory import InMemoryAi, InMemoryStore
from interval_jobs.ai.gateway import AiGateway
from interval_jobs.concepts.graph import parse_concepts
from interval_jobs.concepts.sync import sync_concepts
from interval_jobs.pipeline import ModelJob, moment_text
from interval_jobs.ports import (
    BatchItem,
    BatchNotFound,
    BatchRequest,
    BatchStatus,
    Store,
)
from interval_jobs.question_batches import collect, submit

from .test_pipeline import NOW, NoEmbeddings, World
from .test_question_stage import QuestionLlm, question_world


class FakeBatches:
    """Answers every request as told when collected: well, broken, or failed."""

    provider: AiProvider = "openrouter"

    def __init__(self) -> None:
        self.submitted: dict[str, list[BatchRequest]] = {}
        self.mode = "good"  # good | broken | provider-error | running | failed
        self.wrong_answers = False

    def submit(self, model: str, requests: Sequence[BatchRequest]) -> str:
        batch_id = f"batch_{len(self.submitted) + 1}"
        self.submitted[batch_id] = list(requests)
        return batch_id

    def _reply(self, request: BatchRequest) -> str:
        content = request.messages[1]["content"]
        if request.messages[0]["content"].startswith("You answer a multiple-choice"):
            lines = content.splitlines()
            right = next(
                int(line.split(".")[0]) for line in lines if line.endswith(". It")
            )
            return json.dumps(
                {"answer": (right + 1) % 4 if self.wrong_answers else right}
            )
        passage = content.split("<passage>\n", 1)[1].split("\n</passage>")[0]
        quote = re.split(r"(?<=[.!?])\s", passage.strip())[0][:200]
        one = {
            "stem": "What does the passage say?",
            "options": ["It", "Something else", "Nothing", "Everything"],
            "correct": 0,
            "citation": quote,
        }
        return json.dumps({"questions": [one, {**one, "stem": "And again?"}]})

    def status(self, batch_id: str) -> BatchStatus:
        if self.mode == "running":
            return BatchStatus("running", [], None, None)
        if self.mode == "not-found":
            raise BatchNotFound(f"{batch_id}: not found")
        if self.mode == "failed":
            return BatchStatus("failed", [], None, "expired")
        items = [
            BatchItem(r.custom_id, None, "provider_overloaded", 0, 0)
            if self.mode == "provider-error"
            else BatchItem(
                r.custom_id,
                "not json" if self.mode == "broken" else self._reply(r),
                None,
                1000,
                300,
            )
            for r in self.submitted[batch_id]
        ]
        return BatchStatus("completed", items, Decimal("0.0001"), None)


def batch_setup() -> tuple[InMemoryStore, AiGateway, FakeBatches, InMemoryAi]:
    # Tagged by the pipeline (questions off there: batch mode drafts instead).
    world, _ = question_world(questions=False)
    world.discover()
    world.run()
    ledger = InMemoryAi(InMemoryStore().users)
    batches = FakeBatches()
    gateway = AiGateway(
        ledger, QuestionLlm(), NoEmbeddings(), clock=lambda: NOW, batches=batches
    )
    return world.store, gateway, batches, ledger


def unit_of(store: InMemoryStore) -> Callable[[], AbstractContextManager[Store]]:
    @contextmanager
    def unit() -> Generator[Store]:
        yield store

    return unit


MODEL = "anthropic/claude-haiku-5.5"


def test_a_draft_batch_then_a_validation_batch_make_questions_live() -> None:
    store, gateway, _, ledger = batch_setup()
    unit = unit_of(store)
    targets = store.questions.targets(None)
    assert targets
    sent = submit(unit, gateway, MODEL)
    assert (sent.drafts, sent.validations) == (len(targets), 0)
    # Submitting again while it's open sends nothing twice.
    assert submit(unit, gateway, MODEL).drafts == 0
    got = collect(unit, gateway, MODEL)
    assert got.saved == len(targets) and got.broken == 0
    saved = store.questions.rows
    assert saved and all(q.status == "pending" for q in saved)
    assert {q.difficulty for q in saved} == {"beginner"}
    # Shuffled when saved, the key still on its option.
    assert all(q.draft.options[q.draft.correct] == "It" for q in saved)
    # The batch's cost was recorded once, at collection.
    assert [u.cost_usd for u in ledger.rows] == [Decimal("0.0001")]
    sent = submit(unit, gateway, MODEL)
    assert (sent.drafts, sent.validations) == (0, len(saved))
    assert collect(unit, gateway, MODEL).decided == len(saved)
    assert all(q.status == "live" for q in store.questions.rows)
    # Nothing left to do.
    assert submit(unit, gateway, MODEL) == type(sent)(0, 0)


def test_a_running_batch_waits_and_a_failed_one_frees_its_moments() -> None:
    store, gateway, batches, _ = batch_setup()
    unit = unit_of(store)
    batches.mode = "running"
    first = submit(unit, gateway, MODEL).drafts
    assert collect(unit, gateway, MODEL).closed == 0
    batches.mode = "failed"
    assert collect(unit, gateway, MODEL).failed_batches == 1
    assert store.questions.rows == []
    # Freed: the next submit sends them again.
    assert submit(unit, gateway, MODEL).drafts == first


def test_a_batch_not_found_waits_then_is_failed_once_past_its_window() -> None:
    store, gateway, batches, _ = batch_setup()
    unit = unit_of(store)
    first = submit(unit, gateway, MODEL).drafts
    # OpenRouter reads a new batch as 404 for a moment: it stays open.
    batches.mode = "not-found"
    assert collect(unit, gateway, MODEL).failed_batches == 0
    assert submit(unit, gateway, MODEL).drafts == 0
    # Still unknown two days on (past the 24h window): failed, its moments freed.
    (batch_id, kind, _) = store.questions.open_batches()[0]
    store.questions.batches[batch_id] = (kind, True, NOW - timedelta(days=2))
    assert collect(unit, gateway, MODEL).failed_batches == 1
    assert submit(unit, gateway, MODEL).drafts == first


def test_broken_replies_count_toward_the_cap_and_provider_errors_do_not() -> None:
    store, gateway, batches, _ = batch_setup()
    unit = unit_of(store)
    moments = len(store.questions.targets(None))
    batches.mode = "provider-error"
    submit(unit, gateway, MODEL)
    assert collect(unit, gateway, MODEL).errors == moments
    assert store.questions.broken_counts() == ({}, {})
    batches.mode = "broken"
    for _ in range(5):
        assert submit(unit, gateway, MODEL).drafts == moments
        assert collect(unit, gateway, MODEL).broken == moments
    # Five broken replies each: no more drafts for those moments.
    assert submit(unit, gateway, MODEL).drafts == 0


def test_a_validation_that_disagrees_rejects_the_question() -> None:
    store, gateway, batches, _ = batch_setup()
    unit = unit_of(store)
    submit(unit, gateway, MODEL)
    collect(unit, gateway, MODEL)
    batches.wrong_answers = True
    submit(unit, gateway, MODEL)
    collect(unit, gateway, MODEL)
    assert store.questions.rows
    assert all(q.status == "rejected" for q in store.questions.rows)


def test_batch_mode_keeps_tagging_from_queuing_sync_drafting() -> None:
    llm = QuestionLlm()

    @contextmanager
    def gateway() -> Generator[AiGateway]:
        yield AiGateway(
            InMemoryAi(InMemoryStore().users), llm, NoEmbeddings(), clock=lambda: NOW
        )

    world = World(
        tagging=ModelJob("small-model", gateway),
        questions=ModelJob(f"batch:{MODEL}", gateway),
    )
    sync_concepts(
        world.store,
        parse_concepts(
            "version: 1\nconcepts:\n"
            "  - {slug: write-ahead-log, name: WAL, topic: databases}\n",
            "c.yaml",
        ),
    )
    world.discover()
    world.run()
    assert world.store.questions.targets(None)  # tagged: there was work to queue
    assert world.queue.pending("generate_questions") == 0
    assert llm.question_calls == 0


def test_an_interrupted_collection_records_the_cost_once_and_saves_once() -> None:
    store, gateway, _, ledger = batch_setup()
    unit = unit_of(store)
    submit(unit, gateway, MODEL)
    real_close = store.questions.close_batch

    def crash(*args: object, **kwargs: object) -> None:
        raise RuntimeError("database went away")

    store.questions.close_batch = crash  # type: ignore[method-assign]
    with pytest.raises(RuntimeError):
        collect(unit, gateway, MODEL)
    store.questions.close_batch = real_close  # type: ignore[method-assign]
    first = {q.id for q in store.questions.rows}
    got = collect(unit, gateway, MODEL)
    assert got.closed == 1
    assert len(ledger.rows) == 1  # the cost, once
    assert {q.id for q in store.questions.rows} == first  # nothing saved twice


def test_a_moment_that_changed_before_collection_is_skipped_and_sent_again() -> None:
    store, gateway, _, _ = batch_setup()
    unit = unit_of(store)
    moments = submit(unit, gateway, MODEL).drafts
    # Its article's text changes meanwhile (a re-fetch): a new content hash.
    moment = store.questions.targets(None)[0]
    item_id = next(m.item_id for m in store.moments.rows if m.id == moment)
    item = store.items.rows[item_id]
    assert item.full_text is not None
    text = moment_text(store, store.questions.target(moment))
    first_word = text.split()[0]
    item.full_text = item.full_text.replace(first_word, first_word + "s", 1)
    collect(unit, gateway, MODEL)
    assert all(q.moment_id != moment for q in store.questions.rows)
    assert len({q.moment_id for q in store.questions.rows}) == moments - 1
    assert submit(unit, gateway, MODEL).drafts == 1


def test_a_validation_that_keeps_breaking_stops_after_five() -> None:
    store, gateway, batches, _ = batch_setup()
    unit = unit_of(store)
    submit(unit, gateway, MODEL)
    collect(unit, gateway, MODEL)
    pending = len(store.questions.rows)
    batches.mode = "broken"
    for _ in range(5):
        assert submit(unit, gateway, MODEL).validations == pending
        collect(unit, gateway, MODEL)
    assert submit(unit, gateway, MODEL).validations == 0
    assert all(q.status == "pending" for q in store.questions.rows)
