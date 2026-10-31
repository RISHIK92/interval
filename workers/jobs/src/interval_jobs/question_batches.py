"""Question drafting and validation through the provider's batch API (Q-P2-13,
P2-W8-S05): the same prompts and rules as the per-moment stages (Q-1, Q-P2-08..12),
sent many at a time at half price and collected later (minutes to 24 hours on).

`question-batches` runs `collect` then `submit` every 30 minutes, one run at a time
(the command holds a lock). At most one batch of each kind is open, which bounds
spend in flight (OPS-4). A kind's batch goes lazily (Q-P2-46): once it would hold
MIN_BATCH requests, or once that kind's last batch is MAX_WAIT old. Users' project
notes ride the first batch that goes when NOTES_MODEL is the same batched model;
their share of the cost goes to each user. A moment or question in an open batch
isn't sent again; a broken reply counts toward the cap (QUESTION_BROKEN_REPLIES, per
moment and text, per question); a provider error or a failed batch just frees it for
the next submit. A batch's cost is claimed on its row before it's recorded, and
saving its results can safely run again, so a collection that fails part way is
simply retried. Reads and writes happen in short units of work; the model calls
happen between them, with no transaction open.

shortcut: every run reads each target moment's text (N+1 over the store); fine for a
few thousand moments, batch the reads if that grows."""

from collections.abc import Callable, Mapping
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from interval_jobs import log
from interval_jobs.ai.gateway import AiGateway, OverBudget
from interval_jobs.feed.project_notes import accepted, note_messages
from interval_jobs.pipeline import QUESTION_BROKEN_REPLIES, moment_text
from interval_jobs.ports import (
    PROJECT_NOTE_PROMPT_VERSION,
    BatchItemResult,
    BatchKind,
    BatchNotFound,
    BatchRequest,
    EstimateDraft,
    ModelError,
    NoteBatchEntry,
    QuestionBatchEntry,
    Store,
)
from interval_jobs.questions import PROMPT_VERSION as QUESTIONS_PROMPT_VERSION
from interval_jobs.questions import (
    QuestionReplyError,
    content_hash,
    estimate_agrees,
    estimate_hash,
    estimate_prompt,
    estimate_validation_prompt,
    has_number,
    parse_answer,
    parse_estimate,
    parse_estimate_answer,
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
# Q-P2-46 (owner): a batch goes once it holds at least MIN_BATCH requests, or once its
# kind's last batch is MAX_WAIT old (questions have no fallback, so they can't stall).
MIN_BATCH = 50
MAX_WAIT = timedelta(hours=24)
NOTES_PER_USER = 50  # project notes one user adds to a run's batches

type StoreUnit = Callable[[], AbstractContextManager[Store]]


@dataclass(frozen=True)
class Submitted:
    drafts: int  # moments' multiple-choice drafts
    validations: int
    notes: int = 0
    estimates: int = 0  # moments' estimate drafts, in the same batch (P3-W13-S03b)


@dataclass(frozen=True)
class Collected:
    closed: int
    failed_batches: int
    saved: int
    decided: int
    broken: int
    errors: int
    notes_saved: int = 0


def _note_work(
    unit: StoreUnit, gateway: AiGateway
) -> list[tuple[NoteBatchEntry, BatchRequest]]:
    """Q-P2-46: every project-explained card missing its project note, for users
    whose budget isn't spent (OPS-4), not already in an open batch."""
    work: list[tuple[NoteBatchEntry, BatchRequest]] = []
    with unit() as store:
        github = store.github
        busy = store.questions.notes_in_open_batches()
        for user_id, items in github.project_note_candidates().items():
            if gateway.over_budget("project_notes", user_id):
                continue
            free = [item for item in items if (user_id, item) not in busy]
            for item in github.project_notes_missing(user_id, free, NOTES_PER_USER):
                note = github.project_note_input(user_id, item)
                if note is None:
                    continue
                # Some providers take only [a-z0-9_-] here, and user ids have
                # capitals: numbered, with the user kept on the batch item.
                custom_id = f"note-{len(work)}-{item}"
                names = tuple(name for name, _ in note.repositories)
                work.append(
                    (
                        NoteBatchEntry(
                            custom_id, user_id, item, names, PROJECT_NOTE_PROMPT_VERSION
                        ),
                        BatchRequest(custom_id, note_messages(note)),
                    )
                )
    return work


def submit(
    unit: StoreUnit, gateway: AiGateway, model: str, notes: bool = False
) -> Submitted:
    """Gather every moment whose questions need drafting, every question waiting for
    its verdict and (with `notes`) every missing project note that no open batch is
    working on; each kind's batch goes when it's due (Q-P2-46)."""
    drafts: list[tuple[QuestionBatchEntry, BatchRequest]] = []
    validations: list[tuple[QuestionBatchEntry, BatchRequest]] = []
    with unit() as store:
        questions = store.questions
        open_kinds = {kind for _, kind, _ in questions.open_batches()}
        busy_moments, busy_questions = questions.in_open_batches()
        broken_moments, broken_questions = questions.broken_counts()
        for moment_id in [] if "draft" in open_kinds else questions.targets(None):
            target = questions.target(moment_id)
            text = moment_text(store, target)
            if target is None or not text:
                continue
            slugs = [slug for slug, _ in target.concepts]
            names = [name for _, name in target.concepts]
            digest = content_hash(text, slugs)
            if (
                (moment_id, "choice") not in busy_moments
                and digest != questions.drafted_hash(moment_id)  # AI-4: drafted once
                and broken_moments.get((moment_id, digest), 0) < QUESTION_BROKEN_REPLIES
            ):
                custom_id = f"draft-{moment_id}"
                drafts.append(
                    (
                        QuestionBatchEntry(custom_id, moment_id, None, digest),
                        BatchRequest(custom_id, prompt(text, names)),
                    )
                )
            # P3-W13-S03b: its estimate, only where a number could be stated.
            digest = estimate_hash(text, slugs)
            if (
                has_number(text)
                and (moment_id, "estimate") not in busy_moments
                and digest != questions.estimate_drafted_hash(moment_id)
                and broken_moments.get((moment_id, digest), 0) < QUESTION_BROKEN_REPLIES
            ):
                custom_id = f"estimate-{moment_id}"
                drafts.append(
                    (
                        QuestionBatchEntry(
                            custom_id, moment_id, None, digest, "estimate"
                        ),
                        BatchRequest(custom_id, estimate_prompt(text, names)),
                    )
                )
        pending_ids = [] if "validate" in open_kinds else questions.pending_questions()
        for question_id, kind in pending_ids:
            if (
                question_id in busy_questions
                or broken_questions.get(question_id, 0) >= QUESTION_BROKEN_REPLIES
            ):
                continue
            found = (
                questions.pending_estimate(question_id)
                if kind == "estimate"
                else questions.pending(question_id)
            )
            if found is None:
                continue
            moment_id, draft = found
            text = moment_text(store, questions.target(moment_id))
            if not text:
                continue  # its moment lost its rights meanwhile (ING-2)
            messages = (
                estimate_validation_prompt(text, draft.stem, draft.unit)
                if isinstance(draft, EstimateDraft)
                else validation_prompt(text, draft)
            )
            custom_id = f"validate-{question_id}"
            validations.append(
                (
                    QuestionBatchEntry(custom_id, None, question_id, None, kind),
                    BatchRequest(custom_id, messages),
                )
            )
    riders = _note_work(unit, gateway) if notes else []
    # Notes ride the first batch that goes, drafting before validation.
    sent, sent_notes = _send(unit, gateway, model, "draft", drafts, riders)
    riders = riders[sent_notes:]
    sent_validations, carried = _send(
        unit, gateway, model, "validate", validations, riders
    )
    estimates = sum(e.kind == "estimate" for e, _ in drafts[:sent])
    return Submitted(
        sent - estimates, sent_validations, sent_notes + carried, estimates
    )


def _send(
    unit: StoreUnit,
    gateway: AiGateway,
    model: str,
    kind: BatchKind,
    work: list[tuple[QuestionBatchEntry, BatchRequest]],
    riders: list[tuple[NoteBatchEntry, BatchRequest]],
) -> tuple[int, int]:
    """The questions and project notes sent in this kind's batch, if it was due."""
    # One batch per kind per run (and none while one is open): spend in flight stays
    # bounded by one batch (OPS-4); the rest goes in later runs.
    chunk = work[:MAX_BATCH]
    ride = riders[: MAX_BATCH - len(chunk)]
    if not chunk and not ride:
        return 0, 0  # nothing waiting: no call, no cost
    with unit() as store:
        open_kinds = {k for _, k, _ in store.questions.open_batches()}
        last = store.questions.last_submitted(kind)
    if kind in open_kinds:
        return 0, 0
    # Q-P2-46: lazily, at MIN_BATCH requests, or when this kind's last batch is old.
    due = (
        len(chunk) + len(ride) >= MIN_BATCH
        or last is None
        or datetime.now(UTC) - last >= MAX_WAIT
    )
    if not due:
        return 0, 0
    try:
        batch_id = gateway.submit_batch(
            feature="questions",
            model=model,
            requests=[r for _, r in chunk] + [r for _, r in ride],
        )
    except ModelError as error:
        # shortcut: a submit that fails after the provider accepted it (a timeout)
        # leaves a paid batch nothing names, and the next run sends its requests
        # again; OpenRouter documents no idempotency key to prevent that. Rare; watch
        # this warning.
        log.warn("questions: batch submit failed", kind=kind, error=str(error))
        return 0, 0
    if isinstance(batch_id, OverBudget):
        # OPS-4, LOAD-5: the next run tries again; observable.
        log.warn("questions: batch over budget", kind=kind, scope=batch_id.scope)
        return 0, 0
    # Logged before it's recorded: a crash in between leaves a paid batch that only
    # this line names.
    log.info(
        "questions: batch submitted",
        batch_id=batch_id,
        kind=kind,
        notes=len(ride),
    )
    with unit() as store:
        store.questions.record_batch(
            batch_id, kind, model, [e for e, _ in chunk], [n for n, _ in ride]
        )
    return len(chunk), len(ride)


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
            notes = {n.custom_id: n for n in store.questions.note_entries(batch_id)}
        if claimed:
            # Q-P2-46, OPS-4: each project note's share goes to its user.
            gateway.record_batch_cost(
                feature="questions",
                model=model,
                status=status,
                payers={c: ("project_notes", n.user_id) for c, n in notes.items()},
            )
        with unit() as store:
            entries = {e.custom_id: e for e in store.questions.batch_entries(batch_id)}
            results: dict[str, BatchItemResult] = {}
            for item in status.items:
                note = notes.get(item.custom_id)
                if note is not None:
                    results[item.custom_id] = _save_note(store, note, item.text, model)
                    continue
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
        named = _named({c: r for c, r in results.items() if c not in notes})
        for result, n in named.items():
            counts[result] = counts.get(result, 0) + n
        note_counts = _named({c: r for c, r in results.items() if c in notes})
        saved_notes = note_counts.get("saved", 0)
        counts["note_saved"] = counts.get("note_saved", 0) + saved_notes
        log.info(
            "questions: batch collected",
            batch_id=batch_id,
            **named,
            **{f"notes_{r}": n for r, n in note_counts.items()},
        )
    return Collected(
        closed,
        failed,
        counts.get("saved", 0),
        counts.get("decided", 0),
        counts.get("broken", 0),
        counts.get("error", 0),
        counts.get("note_saved", 0),
    )


def _save_note(
    store: Store, entry: NoteBatchEntry, reply: str | None, model: str
) -> BatchItemResult:
    """A batched project note (Q-P2-46), validated as the direct path's; skipped when
    the user's matching repositories changed since it was asked."""
    if reply is None:
        return "error"
    now = store.github.project_note_input(entry.user_id, entry.item_id)
    if (
        now is None
        or tuple(name for name, _ in now.repositories) != entry.repositories
        or entry.prompt_version != PROJECT_NOTE_PROMPT_VERSION
    ):
        return "skipped"
    text = accepted(reply, entry.user_id)
    # A refused reply is recorded too: not asked again for this repository set.
    store.github.save_project_note(entry.user_id, entry.item_id, now, text, model)
    return "saved" if text is not None else "broken"


def _save_draft(
    store: Store, entry: QuestionBatchEntry, reply: str, model: str
) -> BatchItemResult:
    assert entry.moment_id is not None  # a draft entry always names its moment
    target = store.questions.target(entry.moment_id)
    text = moment_text(store, target)
    slugs = [slug for slug, _ in target.concepts] if target else []
    digest = (estimate_hash if entry.kind == "estimate" else content_hash)(text, slugs)
    if target is None or not text or digest != entry.content_hash:
        return "skipped"  # it changed or lost its rights meanwhile: the next submit
    if entry.kind == "estimate":
        if store.questions.estimate_drafted_hash(entry.moment_id) == digest:
            return "saved"  # saved by an earlier, interrupted collection
        try:
            estimate = parse_estimate(reply, text)
        except QuestionReplyError:
            return "broken"
        # Saved even when the passage states no number: not asked again (AI-4).
        store.questions.save_estimate(
            entry.moment_id, estimate, slugs, model, digest, target.difficulty
        )
        return "saved"
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
    if entry.kind == "estimate":
        pending = store.questions.pending_estimate(entry.question_id)
        if pending is None:
            return "skipped"
        try:
            number = parse_estimate_answer(reply)
        except QuestionReplyError:
            return "broken"
        decided = store.questions.record_estimate_verdict(
            entry.question_id,
            model,
            number,
            estimate_agrees(number, pending[1].answer),
        )
        return "decided" if decided else "skipped"
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
