"""Stand-alone stems for live questions that point at their passage (owner,
2026-11-23): rewritten through the gateway, validated blind again (Q-1), saved only
when the validator picks the key; within the AI budget (OPS-4) and rerunnable
(LOAD-5). The bank is the in-memory one, drafted by the question stage's fakes."""

import json
from collections.abc import Callable, Generator
from contextlib import contextmanager
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from interval_db.generated import AiProvider
from interval_jobs.adapters.memory import InMemoryAi, InMemoryStore, StoredQuestion
from interval_jobs.ai.gateway import AiGateway
from interval_jobs.pipeline import cited_passage
from interval_jobs.ports import (
    Completion,
    EstimateDraft,
    Message,
    ModelError,
    QuestionDraft,
    Store,
)
from interval_jobs.questions import refers_to_source
from interval_jobs.rewrite_stems import (
    REWRITE_PROMPT_VERSION,
    RewriteRun,
    rewrite_stems,
)

from .test_pipeline import NOW, NoEmbeddings, World
from .test_question_stage import question_world

OLD = "According to the passage, what does the log do before a page is written?"
NEW = "What does a write-ahead log record before a database page is written?"
OLD_ESTIMATE = "According to the passage, how many ms does a follower lag?"
NEW_ESTIMATE = "How many ms does a Raft follower lag behind its leader at most?"


def run(
    rewritten: int = 0,
    disagreed: int = 0,
    broken: int = 0,
    errors: int = 0,
    no_text: int = 0,
    options_refer: int = 0,
    changed: int = 0,
    cooling_off: int = 0,
    stopped: str | None = None,
) -> RewriteRun:
    """A RewriteRun with every count zero but those given."""
    return RewriteRun(
        rewritten,
        disagreed,
        broken,
        errors,
        no_text,
        options_refer,
        changed,
        cooling_off,
        stopped,
    )


class RewriteLlm:
    """Rewrites every stem to `stem` (an estimate's to `estimate_stem`); the validator
    finds the key (the option `key`) or, when told, names another option, and answers
    an estimate with `estimate`."""

    provider: AiProvider = "openrouter"

    def __init__(self, stem: str = NEW, key: str = "It") -> None:
        self.stem = stem
        self.key = key
        self.estimate_stem = NEW_ESTIMATE
        self.estimate = 40.0
        self.prompts: list[list[Message]] = []
        self.validator_wrong = False
        self.validator_reply: str | None = None  # instead of the validator's answer
        self.fail = False
        self.cost = Decimal(0)  # each validation's
        self.on_validate: list[
            Callable[[], None]
        ] = []  # callbacks run before a validation

    def complete(self, model: str, messages: list[Message]) -> Completion:
        if self.fail:
            raise ModelError("openrouter: 502")
        self.prompts.append(messages)
        system, user = messages[0]["content"], messages[1]["content"]
        if system.startswith("You rewrite the stem of an estimation"):
            return Completion(
                json.dumps({"stem": self.estimate_stem}), 900, 40, Decimal(0)
            )
        if system.startswith("You rewrite the stem"):
            return Completion(json.dumps({"stem": self.stem}), 900, 40, Decimal(0))
        for callback in self.on_validate:
            callback()
        if self.validator_reply is not None:
            return Completion(self.validator_reply, 900, 5, self.cost)
        if system.startswith("You answer an estimation question"):
            assert f"Question: {self.estimate_stem}\n" in user
            return Completion(json.dumps({"answer": self.estimate}), 900, 5, self.cost)
        assert system.startswith("You answer a multiple-choice")
        assert f"Question: {self.stem}\n" in user
        lines = user.splitlines()
        right = next(
            int(line.split(".")[0]) for line in lines if line.endswith(f". {self.key}")
        )
        answer = (right + 1) % 4 if self.validator_wrong else right
        return Completion(json.dumps({"answer": answer}), 900, 5, self.cost)


def bank(key: str = "It") -> tuple[World, list[StoredQuestion]]:
    """Live questions, drafted and validated by the question stage, their stems then
    set to point at the passage, as the owner's v1 drafts do; the key's text `key`."""
    world, _ = question_world()
    world.discover()
    world.run()
    live = [q for q in world.store.questions.rows if q.status == "live"]
    assert len(live) >= 2
    for q in live:
        assert isinstance(q.draft, QuestionDraft)
        options = tuple(
            key if i == q.draft.correct else o for i, o in enumerate(q.draft.options)
        )
        q.draft = replace(q.draft, stem=OLD, options=options)
        q.prompt_version = 1
    return world, live


def live_estimate(world: World, item_id: int) -> StoredQuestion:
    """A live estimate on `item_id`, its stem pointing at the passage."""
    rows = world.store.questions.rows
    q = StoredQuestion(
        max(r.id for r in rows) + 1,
        item_id,
        0,
        EstimateDraft(OLD_ESTIMATE, 40, "ms", "lag of 40 ms"),
        (),
        "drafter",
        1,
        "estimate-h",
        status="live",
        validator_model="v",
        validator_estimate=41,
        validated_at=datetime.now(UTC),
    )
    rows.append(q)
    return q


def rewrite(
    store: InMemoryStore,
    llm: RewriteLlm,
    limit: int | None = None,
    retry_after: timedelta = timedelta(days=7),
) -> RewriteRun:
    ledger = InMemoryAi(store.users)

    @contextmanager
    def stores() -> Generator[Store]:
        yield store

    gateway = AiGateway(ledger, llm, NoEmbeddings(), clock=lambda: NOW)
    return rewrite_stems(
        stores,
        gateway,
        "qwen-questions",
        limit,
        retry_after=retry_after,
        now=datetime.now(UTC),
    )


def choice(q: StoredQuestion) -> QuestionDraft:
    assert isinstance(q.draft, QuestionDraft)
    return q.draft


def test_a_stem_the_validator_still_answers_is_rewritten_and_saved() -> None:
    world, live = bank()
    before = {q.id: choice(q) for q in live}
    drafted_by = {q.id: q.model for q in live}
    llm = RewriteLlm()
    got = rewrite(world.store, llm)
    assert got == run(rewritten=len(live))
    for q in live:
        # The stem only: options, key and citation stay as validated before.
        assert choice(q) == replace(before[q.id], stem=NEW)
        assert q.status == "live"
        # The drafting model stays (it wrote the options and key); the rewrite is
        # told apart by its own prompt version, past any draft's.
        assert (q.model, q.prompt_version) == (drafted_by[q.id], 1001)
        assert q.validator_model == "qwen-questions"
        assert q.validator_answer == choice(q).correct
        # Validated now: new AI text enters the spot-check sample (Q-2).
        assert q.validated_at is not None and q.stem_tried_at is not None
    assert REWRITE_PROMPT_VERSION == 1001
    # The rewrite saw the old stem, the options and the key, to keep its meaning,
    # and is told not to give the key away.
    system, user = llm.prompts[0]
    assert "never refer to its source" in system["content"]
    assert "never give away the correct option" in system["content"]
    assert f"Stem: {OLD}" in user["content"] and "Correct option: " in user["content"]


def test_rewritten_questions_are_not_picked_again() -> None:
    world, live = bank()
    rewrite(world.store, RewriteLlm())
    llm = RewriteLlm()
    again = rewrite(world.store, llm)
    assert again == run()
    assert llm.prompts == []
    assert all(choice(q).stem == NEW for q in live)


def test_a_limit_takes_that_many_and_a_rerun_carries_on() -> None:
    world, live = bank()
    assert rewrite(world.store, RewriteLlm(), limit=1).rewritten == 1
    assert [choice(q).stem for q in live].count(NEW) == 1
    assert rewrite(world.store, RewriteLlm()).rewritten == len(live) - 1
    assert all(choice(q).stem == NEW for q in live)


def test_a_limited_rerun_moves_past_questions_that_failed() -> None:
    """Review, 2026-11-23: the oldest failures don't block (and bill) every rerun."""
    world, live = bank()
    llm = RewriteLlm()
    llm.validator_wrong = True
    first = rewrite(world.store, llm, limit=1)
    assert first == run(disagreed=1)
    tried = [q.id for q in live if q.stem_tried_at is not None]
    assert tried == [live[0].id]
    # The next limited run takes one never tried, and skips the failure for now.
    second = rewrite(world.store, llm, limit=1)
    assert second == run(disagreed=1, cooling_off=1)
    assert live[1].stem_tried_at is not None
    # Once all have been tried, nothing is sent until the cool-off has passed.
    for q in live[2:]:
        q.stem_tried_at = datetime.now(UTC)
    llm.prompts.clear()
    assert rewrite(world.store, llm) == run(cooling_off=len(live))
    assert llm.prompts == []
    # A try older than the cool-off is due again, the oldest try first.
    live[1].stem_tried_at = datetime.now(UTC) - timedelta(days=8)
    live[0].stem_tried_at = datetime.now(UTC) - timedelta(days=9)
    llm.validator_wrong = False
    got = rewrite(world.store, llm, limit=1)
    assert got == run(rewritten=1, cooling_off=len(live) - 2)
    assert choice(live[0]).stem == NEW and choice(live[1]).stem == OLD
    # A shorter cool-off, as the owner may ask for, retries sooner.
    got = rewrite(world.store, llm, retry_after=timedelta(0))
    assert got == run(rewritten=len(live) - 1)


def test_a_rewrite_the_validator_disagrees_with_is_left_as_it_was() -> None:
    world, live = bank()
    before = {q.id: (choice(q), q.validator_answer, q.model) for q in live}
    llm = RewriteLlm()
    llm.validator_wrong = True
    got = rewrite(world.store, llm)
    assert (got.rewritten, got.disagreed) == (0, len(live))
    assert {q.id: (choice(q), q.validator_answer, q.model) for q in live} == before
    assert all(q.status == "live" and q.prompt_version == 1 for q in live)


def test_a_validator_reply_that_is_not_json_counts_as_broken() -> None:
    world, live = bank()
    llm = RewriteLlm()
    llm.validator_reply = "B, I think"
    got = rewrite(world.store, llm)
    assert got == run(broken=len(live))
    assert all(choice(q).stem == OLD for q in live)


def test_a_stem_changed_meanwhile_is_counted_and_not_overwritten() -> None:
    world, live = bank()
    edited = "What does a WAL write first?"
    llm = RewriteLlm()

    def edit_first() -> None:
        # An admin's edit lands while the first rewrite is being validated.
        if choice(live[0]).stem == OLD:
            live[0].draft = replace(choice(live[0]), stem=edited)

    llm.on_validate.append(edit_first)
    got = rewrite(world.store, llm, limit=1)
    assert got == run(changed=1)
    assert choice(live[0]).stem == edited and live[0].prompt_version == 1


def test_a_rewrite_that_still_refers_to_its_source_is_not_validated_or_saved() -> None:
    world, live = bank()
    still = "Per the article, what does a write-ahead log record first?"
    assert refers_to_source(still)
    llm = RewriteLlm(stem=still)
    got = rewrite(world.store, llm)
    assert (got.rewritten, got.broken) == (0, len(live))
    assert all(choice(q).stem == OLD for q in live)
    # Only the rewrite requests: a broken stem never reaches the validator.
    assert all(p[0]["content"].startswith("You rewrite") for p in llm.prompts)


@pytest.mark.parametrize(
    ("key", "stem", "leaks"),
    [
        (
            "The change, before the page",
            "Does a write-ahead log record the change before the page is written?",
            True,
        ),
        ("B-tree", "Why is a b-tree index slower to update here than an LSM?", True),
        ("Yes", "Must a WAL be flushed first? Answer yes or no.", True),
        # Whole words only: a short key inside another word gives nothing away.
        ("Yes", "What does Yesod's persistence layer flush first?", False),
        ("B-tree", "Which index do B-trees lose to on writes?", False),
    ],
)
def test_a_rewrite_that_contains_the_key_is_broken(
    key: str, stem: str, leaks: bool
) -> None:
    world, live = bank(key)
    llm = RewriteLlm(stem=stem, key=key)
    got = rewrite(world.store, llm)
    if leaks:
        assert got == run(broken=len(live))
        assert all(choice(q).stem == OLD for q in live)
        assert all(p[0]["content"].startswith("You rewrite") for p in llm.prompts)
    else:
        assert got == run(rewritten=len(live))


def test_a_model_error_is_counted_and_left_for_a_later_run() -> None:
    world, live = bank()
    llm = RewriteLlm()
    llm.fail = True
    got = rewrite(world.store, llm)
    assert got == run(errors=len(live))
    assert all(choice(q).stem == OLD for q in live)
    # Tried, so a limited rerun moves on; due again after the cool-off.
    assert all(q.stem_tried_at is not None for q in live)


def test_a_spent_budget_stops_the_run_cleanly_and_a_rerun_finishes() -> None:
    world, live = bank()
    llm = RewriteLlm()
    # The first question's validation spends the whole global day (OPS-4).
    llm.cost = Decimal(1000)
    got = rewrite(world.store, llm)
    assert got.rewritten == 1 and got.stopped == "the global AI budget is spent"
    assert [choice(q).stem for q in live].count(NEW) == 1
    # Stopped by the budget is not a try: the rest stay never tried.
    assert [q.stem_tried_at is None for q in live].count(True) == len(live) - 1
    # A later run (a fresh day's ledger here) carries on with the rest (LOAD-5).
    llm.cost = Decimal(0)
    assert rewrite(world.store, llm).rewritten == len(live) - 1
    assert all(choice(q).stem == NEW for q in live)


def test_only_the_text_the_rights_allow_is_sent() -> None:
    world, live = bank()
    target = world.store.questions.target(live[0].item_id)
    text = cited_passage(world.store, target, live[0].draft.citation)
    assert text
    llm = RewriteLlm()
    rewrite(world.store, llm, limit=1)
    # The article's passage around the question's citation, as validation reads it.
    assert f"<passage>\n{text}\n</passage>" in llm.prompts[0][1]["content"]
    # A source whose rights no longer allow full text: nothing is sent (ING-2).
    world.store.sources.rows[world.source_id].rights_profile = "metadata_only"
    llm = RewriteLlm()
    got = rewrite(world.store, llm, retry_after=timedelta(0))
    assert (got.no_text, got.rewritten, llm.prompts) == (len(live) - 1, 0, [])
    # Nor once the article has no live concept (not a target).
    world.store.sources.rows[world.source_id].rights_profile = "full_text_internal"
    world.store.tags.rows.clear()
    got = rewrite(world.store, llm, retry_after=timedelta(0))
    assert (got.no_text, llm.prompts) == (len(live) - 1, [])


def test_a_question_whose_option_refers_to_its_source_is_counted_not_sent() -> None:
    world, live = bank()
    first = choice(live[0])
    options = tuple(
        o if i == first.correct else f"Whatever the passage says ({i})"
        for i, o in enumerate(first.options)
    )
    live[0].draft = replace(first, options=options)
    llm = RewriteLlm()
    got = rewrite(world.store, llm)
    assert (got.options_refer, got.rewritten) == (1, len(live) - 1)
    assert choice(live[0]).stem == OLD and live[0].stem_tried_at is None


def test_a_live_estimate_gets_a_stand_alone_stem_when_the_validator_agrees() -> None:
    world, live = bank()
    estimate = live_estimate(world, live[0].item_id)
    llm = RewriteLlm()
    # Within the drafting rule's factor (ESTIMATE_AGREES) of the key.
    llm.estimate = 45
    got = rewrite(world.store, llm)
    assert got == run(rewritten=len(live) + 1)
    assert estimate.draft == EstimateDraft(NEW_ESTIMATE, 40, "ms", "lag of 40 ms")
    assert (estimate.model, estimate.prompt_version) == ("drafter", 1001)
    assert (estimate.validator_model, estimate.validator_estimate) == (
        "qwen-questions",
        45,
    )
    # The rewrite saw the answer and unit, to keep its meaning and leave them out.
    sent = next(
        p
        for p in llm.prompts
        if p[0]["content"].startswith("You rewrite the stem of an estimation")
    )
    assert "never give away the answer" in sent[0]["content"]
    assert f"Stem: {OLD_ESTIMATE}" in sent[1]["content"]
    assert "Answer: 40 ms" in sent[1]["content"]


def test_an_estimate_the_validator_puts_elsewhere_is_left_as_it_was() -> None:
    world, live = bank()
    estimate = live_estimate(world, live[0].item_id)
    llm = RewriteLlm()
    llm.estimate = 60  # past the factor: the new stem may ask something else
    got = rewrite(world.store, llm)
    assert (got.disagreed, got.rewritten) == (1, len(live))
    assert estimate.draft.stem == OLD_ESTIMATE and estimate.prompt_version == 1
    assert estimate.validator_estimate == 41


def test_an_estimate_rewrite_that_gives_the_answer_away_is_broken() -> None:
    world, live = bank()
    estimate = live_estimate(world, live[0].item_id)
    llm = RewriteLlm()
    llm.estimate_stem = "A Raft follower lags its leader by 40 ms: how many ms?"
    got = rewrite(world.store, llm)
    assert (got.broken, got.rewritten) == (1, len(live))
    assert estimate.draft.stem == OLD_ESTIMATE
