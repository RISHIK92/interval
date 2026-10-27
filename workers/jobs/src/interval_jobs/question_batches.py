"""Question drafting and validation through the provider's batch API (Q-P2-13,
P2-W8-S05): the same prompts and rules as the per-moment stages (Q-1, Q-P2-08..12),
sent many at a time at half price and collected later (minutes to 24 hours on).

`question-batches` runs `collect` then `submit` every 30 minutes, one run at a time (the
command holds a lock). At most one batch of each kind is open, which bounds spend in
flight (OPS-4). A moment or question in an open batch isn't sent again; a broken reply
counts toward the cap (QUESTION_BROKEN_REPLIES, per moment and text, per question); a
provider error or a failed batch just frees it for the next submit. A batch's cost is
claimed on its row before it's recorded, and saving its results can safely run again,
so a collection that fails part way is simply retried. Reads and writes happen in
short units of work; the model calls happen between them, with no transaction open.

shortcut: every run reads each target moment's text (N+1 over the store); fine for a
few thousand moments, batch the reads if that grows."""

from collections.abc import Callable, Mapping
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from interval_jobs import log
from interval_jobs.ai.gateway import AiGateway, OverBudget
from interval_jobs.pipeline import QUESTION_BROKEN_REPLIES, moment_text
from interval_jobs.ports import (
    BatchItemResult,
    BatchKind,
    BatchNotFound,
    BatchRequest,
    ModelError,
    QuestionBatchEntry,
    Store,
)
from interval_jobs.questions import PROMPT_VERSION as QUESTIONS_PROMPT_VERSION
from interval_jobs.questions import (
    QuestionReplyError,
    content_hash,
    parse_answer,
    parse_reply,
    prompt,
    shuffled,
    validation_prompt,
)

# Requests per batch: well inside the provider's 200 MB body (4,000-character
# passages), and a failed batch frees no more than this.
MAX_BATCH = 1000
# A batch the provider still doesn't know this long after submitting (its window is
# 24h) never will.
UNKNOWN_AFTER = timedelta(hours=48)

type StoreUnit = Callable[[], AbstractContextManager[Store]]


@dataclass(frozen=True)
class Submitted:
    drafts: int
    validations: int


@dataclass(frozen=True)
class Collected:
    closed: int
    failed_batches: int
    saved: int
    decided: int
    broken: int
    errors: int


def submit(unit: StoreUnit, gateway: AiGateway, model: str) -> Submitted:
    """Send every moment whose questions need drafting and every question waiting
    for its verdict that no open batch is already working on."""
    drafts: list[tuple[QuestionBatchEntry, BatchRequest]] = []
    validations: list[tuple[QuestionBatchEntry, BatchRequest]] = []
    with unit() as store:
        questions = store.questions
        open_kinds = {kind for _, kind, _ in questions.open_batches()}
        busy_moments, busy_questions = questions.in_open_batches()
        broken_moments, broken_questions = questions.broken_counts()
        for moment_id in [] if "draft" in open_kinds else questions.targets(None):
            if moment_id in busy_moments:
                continue
            target = questions.target(moment_id)
            text = moment_text(store, target)
            if target is None or not text:
                continue
            digest = content_hash(text, [slug for slug, _ in target.concepts])
            if (
                digest == questions.drafted_hash(moment_id)  # AI-4: drafted once
                or broken_moments.get((moment_id, digest), 0) >= QUESTION_BROKEN_REPLIES
            ):
                continue
            custom_id = f"draft-{moment_id}"
            drafts.append(
                (
                    QuestionBatchEntry(custom_id, moment_id, None, digest),
                    BatchRequest(
                        custom_id, prompt(text, [name for _, name in target.concepts])
                    ),
                )
            )
        pending_ids = [] if "validate" in open_kinds else questions.pending_questions()
        for question_id in pending_ids:
            pending = questions.pending(question_id)
            if (
                question_id in busy_questions
                or pending is None
                or broken_questions.get(question_id, 0) >= QUESTION_BROKEN_REPLIES
            ):
                continue
            text = moment_text(store, questions.target(pending[0]))
            if not text:
                continue  # its moment lost its rights meanwhile (ING-2)
            custom_id = f"validate-{question_id}"
            validations.append(
                (
                    QuestionBatchEntry(custom_id, None, question_id, None),
                    BatchRequest(custom_id, validation_prompt(text, pending[1])),
                )
            )
    sent_drafts = _send(unit, gateway, model, "draft", drafts)
    sent_validations = _send(unit, gateway, model, "validate", validations)
    return Submitted(sent_drafts, sent_validations)


def _send(
    unit: StoreUnit,
    gateway: AiGateway,
    model: str,
    kind: BatchKind,
    work: list[tuple[QuestionBatchEntry, BatchRequest]],
) -> int:
    # One batch per kind per run (and none while one is open): spend in flight stays
    # bounded by one batch (OPS-4); the rest goes in later runs.
    chunk = work[:MAX_BATCH]
    if not chunk:
        return 0
    try:
        batch_id = gateway.submit_batch(
            feature="questions", model=model, requests=[r for _, r in chunk]
        )
    except ModelError as error:
        # shortcut: a submit that fails after the provider accepted it (a timeout)
        # leaves a paid batch nothing names, and the next run sends its requests
        # again; OpenRouter documents no idempotency key to prevent that. Rare; watch
        # this warning.
        log.warn("questions: batch submit failed", kind=kind, error=str(error))
        return 0
    if isinstance(batch_id, OverBudget):
        # OPS-4, LOAD-5: the next run tries again; observable.
        log.warn("questions: batch over budget", kind=kind, scope=batch_id.scope)
        return 0
    # Logged before it's recorded: a crash in between leaves a paid batch that only
    # this line names.
    log.info("questions: batch submitted", batch_id=batch_id, kind=kind)
    with unit() as store:
        store.questions.record_batch(batch_id, kind, model, [e for e, _ in chunk])
    return len(chunk)


def collect(unit: StoreUnit, gateway: AiGateway, model: str) -> Collected:
    """Close every finished batch: save drafts, record verdicts, free what failed."""
    with unit() as store:
        open_batches = store.questions.open_batches()
    closed = failed = 0
    counts: dict[str, int] = {}
    for batch_id, kind, submitted_at in open_batches:
        try:
            status = gateway.batch_status(batch_id)
        except BatchNotFound as error:
            if datetime.now(UTC) - submitted_at < UNKNOWN_AFTER:
                log.warn(
                    "questions: batch not found yet",
                    batch_id=batch_id,
                    error=str(error),
                )
                continue
            # Past the provider's 24h window it can't still be running: failed, so
            # its moments and questions aren't stranded behind it.
            log.warn("questions: batch unknown, failed", batch_id=batch_id)
            with unit() as store:
                store.questions.close_batch(batch_id, "failed", {})
            failed += 1
            continue
        except ModelError as error:
            # A balance hold or a bad read: polled again on the next run.
            log.warn(
                "questions: batch not readable", batch_id=batch_id, error=str(error)
            )
            continue
        if status.state == "running":
            continue
        if status.state == "failed":
            log.warn("questions: batch failed", batch_id=batch_id, error=status.error)
            with unit() as store:
                store.questions.close_batch(batch_id, "failed", {})
            failed += 1
            continue
        assert status.cost_usd is not None  # the adapter refuses a finished one without
        # Claimed in its own unit first: only the claimer records the cost, so a
        # collection that fails below and runs again doesn't record it twice.
        with unit() as store:
            claimed = store.questions.claim_batch_cost(batch_id, status.cost_usd)
        if claimed:
            gateway.record_batch_cost(feature="questions", model=model, status=status)
        with unit() as store:
            entries = {e.custom_id: e for e in store.questions.batch_entries(batch_id)}
            results: dict[str, BatchItemResult] = {}
            for item in status.items:
                entry = entries.get(item.custom_id)
                if entry is None:
                    continue
                if item.text is None:
                    results[item.custom_id] = "error"
                elif kind == "draft":
                    results[item.custom_id] = _save_draft(
                        store, entry, item.text, model
                    )
                else:
                    results[item.custom_id] = _decide(store, entry, item.text, model)
            # Entries with no result (a part-run batch) are freed by the close.
            store.questions.close_batch(batch_id, "completed", results)
        closed += 1
        named = _named(results)
        for result, n in named.items():
            counts[result] = counts.get(result, 0) + n
        log.info("questions: batch collected", batch_id=batch_id, **named)
    return Collected(
        closed,
        failed,
        counts.get("saved", 0),
        counts.get("decided", 0),
        counts.get("broken", 0),
        counts.get("error", 0),
    )


def _save_draft(
    store: Store, entry: QuestionBatchEntry, reply: str, model: str
) -> BatchItemResult:
    assert entry.moment_id is not None  # a draft entry always names its moment
    target = store.questions.target(entry.moment_id)
    text = moment_text(store, target)
    slugs = [slug for slug, _ in target.concepts] if target else []
    if target is None or not text or content_hash(text, slugs) != entry.content_hash:
        return "skipped"  # it changed or lost its rights meanwhile: the next submit
    if store.questions.drafted_hash(entry.moment_id) == entry.content_hash:
        return "saved"  # saved by an earlier, interrupted collection of this batch
    try:
        drafts = parse_reply(reply, text)
    except QuestionReplyError:
        return "broken"
    store.questions.save(
        entry.moment_id,
        [shuffled(draft) for draft in drafts],
        slugs,
        model,
        QUESTIONS_PROMPT_VERSION,
        content_hash(text, slugs),
        target.difficulty,
    )
    return "saved"


def _decide(
    store: Store, entry: QuestionBatchEntry, reply: str, model: str
) -> BatchItemResult:
    assert entry.question_id is not None  # a validation entry always names one
    try:
        answer = parse_answer(reply)
    except QuestionReplyError:
        return "broken"
    decided = store.questions.record_verdict(entry.question_id, model, answer)
    return "decided" if decided else "skipped"


def _named(results: Mapping[str, BatchItemResult]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for result in results.values():
        counts[result] = counts.get(result, 0) + 1
    return counts
