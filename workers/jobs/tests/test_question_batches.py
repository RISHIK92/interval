"""Question drafting and validation through a batch API (Q-P2-13, P2-W8-S05): submit
what needs doing, collect it later at half price. A fake batch client plays the
provider; the store is the in-memory one, tagged by the pipeline."""

import json
import re
from collections.abc import Callable, Generator, Sequence
from contextlib import AbstractContextManager, contextmanager
from datetime import timedelta
from decimal import ROUND_DOWN, Decimal

import pytest

from interval_db.generated import AiFeature, AiProvider
from interval_jobs import question_batches
from interval_jobs.adapters.memory import (
    InMemoryAi,
    InMemoryStore,
    StoredGitHub,
    StoredUser,
)
from interval_jobs.ai.gateway import AiGateway
from interval_jobs.concepts.graph import parse_concepts
from interval_jobs.concepts.sync import sync_concepts
from interval_jobs.pipeline import ModelJob, moment_text, notes_batched
from interval_jobs.ports import (
    BatchItem,
    BatchNotFound,
    BatchRequest,
    BatchStatus,
    ProjectNoteInput,
    Store,
    Usage,
)
from interval_jobs.question_batches import Submitted, collect, submit

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
        if "their own project" in request.messages[0]["content"]:
            return "Its leader election uses the same idea."
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


# These tests are about what a batch does, not when it goes: one request is enough.
# The Q-P2-46 rule (50 requests, or a day since the kind's last batch) has its own.
@pytest.fixture(autouse=True)
def send_any_size(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(question_batches, "MIN_BATCH", 1)


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


# Q-P2-46: project notes ride the question batches, which go lazily.
def notes_setup(
    users: tuple[str, ...] = ("u1",), items: int = 3
) -> tuple[InMemoryStore, AiGateway, FakeBatches, InMemoryAi]:
    store, _, batches, _ = batch_setup()
    people = InMemoryStore().users
    for user in users:
        people.rows[user] = StoredUser(user, is_anonymous=False)
        store.github.accounts[user] = StoredGitHub(installations=[(11, "octo")])
        store.github.note_candidates[user] = list(range(100, 100 + items))
        for item in range(100, 100 + items):
            store.github.project_inputs[(user, item)] = ProjectNoteInput(
                f"Post {item}", "Example", ("etcd",), (("octo/velox", "A store"),)
            )
    ledger = InMemoryAi(people)
    gateway = AiGateway(
        ledger, QuestionLlm(), NoEmbeddings(), clock=lambda: NOW, batches=batches
    )
    return store, gateway, batches, ledger


def drain(store: InMemoryStore, gateway: AiGateway) -> None:
    """Draft and validate everything once, so only notes are left waiting."""
    unit = unit_of(store)
    for _ in range(2):
        submit(unit, gateway, MODEL)
        collect(unit, gateway, MODEL)


def age_batches(store: InMemoryStore, by: timedelta) -> None:
    store.questions.batches = {
        b: (kind, is_open, at - by)
        for b, (kind, is_open, at) in store.questions.batches.items()
    }


def test_a_few_notes_wait_for_fifty_requests_or_a_day(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(question_batches, "MIN_BATCH", 50)
    store, gateway, batches, ledger = notes_setup(users=("UserWithCaps",), items=3)
    drain(store, gateway)
    sent_before = len(batches.submitted)
    unit = unit_of(store)
    # Three notes, recent batches of both kinds: nothing goes.
    assert submit(unit, gateway, MODEL, notes=True).notes == 0
    assert len(batches.submitted) == sent_before
    # A day later the drafting batch is due, and the notes ride it.
    age_batches(store, timedelta(hours=24))
    sent = submit(unit, gateway, MODEL, notes=True)
    assert (sent.drafts, sent.notes) == (0, 3)
    batch_id = max(batches.submitted)
    assert store.questions.batches[batch_id][0] == "draft"
    # The provider takes only [a-z0-9_-] ids; user ids have capitals.
    assert all(
        re.fullmatch(r"[a-z0-9_-]+", r.custom_id) for r in batches.submitted[batch_id]
    )
    ledger.rows.clear()
    got = collect(unit, gateway, MODEL)
    assert got.notes_saved == 3
    saved = store.github.project_notes
    assert {item for _, item in saved} == {100, 101, 102}
    assert all(
        text == "Its leader election uses the same idea."
        for _, text, _, _ in saved.values()
    )
    # The notes' share of the cost went to the user, under project notes.
    assert {(u.feature, u.user_id) for u in ledger.rows} == {
        ("project_notes", "UserWithCaps")
    }
    assert sum(u.cost_usd for u in ledger.rows) == Decimal("0.0001")
    # Written once: nothing is asked again.
    age_batches(store, timedelta(hours=24))
    assert submit(unit, gateway, MODEL, notes=True).notes == 0


def test_fifty_requests_go_at_once_and_each_user_is_capped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(question_batches, "MIN_BATCH", 50)
    monkeypatch.setattr(question_batches, "NOTES_PER_USER", 30)
    store, gateway, _, _ = notes_setup(users=("u1", "u2"), items=40)
    drain(store, gateway)
    sent = submit(unit_of(store), gateway, MODEL, notes=True)
    assert sent.notes == 60  # 30 each: 50 or more, so it goes without waiting


def test_a_user_over_budget_adds_no_notes() -> None:
    store, gateway, _, ledger = notes_setup(users=("u1", "u2"), items=2)
    drain(store, gateway)
    ledger.record(
        Usage("u1", "project_notes", "openrouter", "m", 0, 0, Decimal(1), NOW)
    )
    age_batches(store, timedelta(hours=24))
    unit = unit_of(store)
    assert submit(unit, gateway, MODEL, notes=True).notes == 2
    entries = store.questions.note_entries(max(store.questions.batches))
    assert {e.user_id for e in entries} == {"u2"}


def test_a_changed_repository_skips_and_a_failed_batch_frees_notes() -> None:
    store, gateway, batches, _ = notes_setup(items=2)
    drain(store, gateway)
    age_batches(store, timedelta(hours=24))
    unit = unit_of(store)
    assert submit(unit, gateway, MODEL, notes=True).notes == 2
    # Still in an open batch: not sent twice.
    age_batches(store, timedelta(hours=24))
    assert submit(unit, gateway, MODEL, notes=True).notes == 0
    batches.mode = "failed"
    collect(unit, gateway, MODEL)
    assert store.github.project_notes == {}
    batches.mode = "good"
    age_batches(store, timedelta(hours=24))
    assert submit(unit, gateway, MODEL, notes=True).notes == 2  # freed
    store.github.project_inputs[("u1", 100)] = ProjectNoteInput(
        "Post 100", "Example", ("etcd",), (("octo/zeta", None),)
    )
    collect(unit, gateway, MODEL)
    assert {item for _, item in store.github.project_notes} == {101}


def test_notes_ride_batches_only_when_both_models_are_the_same_batched_one() -> None:
    assert notes_batched("batch:m", "batch:m")
    assert not notes_batched("batch:m", "batch:other")
    assert not notes_batched("m", "batch:m")
    assert not notes_batched("batch:m", None)
    assert not notes_batched(None, "batch:m")


def test_nothing_waiting_means_no_batch() -> None:
    store, gateway, batches, _ = notes_setup(items=0)
    drain(store, gateway)
    before = len(batches.submitted)
    age_batches(store, timedelta(hours=48))
    assert submit(unit_of(store), gateway, MODEL, notes=True) == Submitted(0, 0, 0)
    assert len(batches.submitted) == before


def test_notes_ride_the_validation_batch_when_drafting_is_open() -> None:
    store, gateway, _, _ = notes_setup(items=2)
    drain(store, gateway)
    store.questions.record_batch("open-draft", "draft", MODEL, [])
    age_batches(store, timedelta(hours=24))
    assert submit(unit_of(store), gateway, MODEL, notes=True).notes == 2
    assert store.questions.note_entries("open-draft") == []
    ridden = [b for b in store.questions.batches if store.questions.note_entries(b)]
    assert [store.questions.batches[b][0] for b in ridden] == ["validate"]


def test_a_mixed_batch_splits_its_cost_by_tokens() -> None:
    store, gateway, _, ledger = notes_setup(items=2)
    unit = unit_of(store)
    drafts = len(store.questions.targets(None))
    sent = submit(unit, gateway, MODEL, notes=True)
    assert (sent.drafts, sent.notes) == (drafts, 2)
    collect(unit, gateway, MODEL)
    by_payer = {(u.feature, u.user_id): u.cost_usd for u in ledger.rows}
    # Every request costs the same tokens: the user pays 2 of drafts + 2 shares,
    # rounded down; the global group takes the remainder.
    expected = (Decimal("0.0001") * 2 / (drafts + 2)).quantize(
        Decimal("0.000001"), rounding=ROUND_DOWN
    )
    assert by_payer[("project_notes", "u1")] == expected
    assert sum(by_payer.values()) == Decimal("0.0001")
    assert by_payer[("questions", None)] >= 0


def test_many_small_shares_never_go_negative() -> None:
    ledger = InMemoryAi(InMemoryStore().users)
    gateway = AiGateway(
        ledger, QuestionLlm(), NoEmbeddings(), clock=lambda: NOW, batches=FakeBatches()
    )
    items = [BatchItem(f"note-{n}-1", "x", None, 10, 10) for n in range(60)]
    payers: dict[str, tuple[AiFeature, str | None]] = {
        i.custom_id: ("project_notes", f"user{n}") for n, i in enumerate(items)
    }
    status = BatchStatus("completed", items, Decimal("0.0001"), None)
    gateway.record_batch_cost(
        feature="questions", model=MODEL, status=status, payers=payers
    )
    assert all(u.cost_usd >= 0 for u in ledger.rows)
    assert sum(u.cost_usd for u in ledger.rows) == Decimal("0.0001")


def test_a_refused_note_is_recorded_and_an_errored_one_goes_again() -> None:
    store, gateway, batches, _ = notes_setup(items=1)
    drain(store, gateway)
    unit = unit_of(store)
    age_batches(store, timedelta(hours=24))
    batches.mode = "provider-error"
    assert submit(unit, gateway, MODEL, notes=True).notes == 1
    collect(unit, gateway, MODEL)
    assert store.github.project_notes == {}
    age_batches(store, timedelta(hours=24))
    batches.mode = "broken"  # "not json": one line, but say it is too long
    assert submit(unit, gateway, MODEL, notes=True).notes == 1  # the error goes again


def test_a_too_long_reply_is_refused_and_not_asked_again(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store, gateway, _, _ = notes_setup(items=1)
    drain(store, gateway)

    def too_long(self: FakeBatches, request: BatchRequest) -> str:
        return "Too long. " * 40

    monkeypatch.setattr(FakeBatches, "_reply", too_long)
    unit = unit_of(store)
    age_batches(store, timedelta(hours=24))
    assert submit(unit, gateway, MODEL, notes=True).notes == 1
    collect(unit, gateway, MODEL)
    ((_, text, _, _),) = store.github.project_notes.values()
    assert text is None
    age_batches(store, timedelta(hours=24))
    assert submit(unit, gateway, MODEL, notes=True).notes == 0


def test_questions_alone_wait_for_fifty_or_a_day(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(question_batches, "MIN_BATCH", 50)
    store, gateway, batches, _ = batch_setup()
    unit = unit_of(store)
    assert 0 < len(store.questions.targets(None)) < 50
    # A drafting batch went recently (now closed): a few drafts wait.
    store.questions.record_batch("recent", "draft", MODEL, [])
    store.questions.close_batch("recent", "completed", {})
    assert submit(unit, gateway, MODEL).drafts == 0
    assert list(batches.submitted) == []
    age_batches(store, timedelta(hours=24))
    assert submit(unit, gateway, MODEL).drafts == len(store.questions.targets(None))
