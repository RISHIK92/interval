"""A question trial (Q-P2-13): before the backfill runs on a batch model, the same few
moments are drafted and blind-validated by it, through the gateway (costs land in
ai_usage, OPS-4), and nothing is saved to the question bank. The same prompts and
rules as question_batches; the report says how many replies broke and why, how often
the validator agreed, and every question to read."""

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from decimal import Decimal

from interval_jobs import log
from interval_jobs.ai.gateway import AiGateway, OverBudget
from interval_jobs.pipeline import moment_text
from interval_jobs.ports import (
    BatchItem,
    BatchRequest,
    BatchStatus,
    ModelError,
    QuestionDraft,
    Store,
)
from interval_jobs.questions import (
    QuestionReplyError,
    parse_answer,
    parse_reply,
    prompt,
    shuffled,
    validation_prompt,
)

POLL_S = 60.0
TIMEOUT_S = 6 * 3600.0


class TrialError(RuntimeError):
    """The trial can't finish: a batch failed, was refused, or ran too long."""


@dataclass(frozen=True)
class TrialMoment:
    moment_id: int
    text: str
    concepts: list[str]


@dataclass(frozen=True)
class TrialQuestion:
    moment_id: int
    stem: str
    options: tuple[str, ...]
    key: int
    validator: int | None
    citation: str


@dataclass
class TrialReport:
    model: str
    moments: int
    drafted: int = 0
    broken: dict[str, int] = field(default_factory=dict[str, int])
    errors: int = 0
    # In the batch but with no result (a part-run one): neither broken nor an error.
    missing: int = 0
    validation_broken: int = 0
    validation_errors: int = 0
    notes: list[str] = field(default_factory=list[str])
    questions: list[TrialQuestion] = field(default_factory=list[TrialQuestion])
    agreed: int = 0
    cost_usd: Decimal = Decimal(0)
    input_tokens: int = 0
    output_tokens: int = 0


def trial_moments(store: Store, limit: int) -> list[TrialMoment]:
    """The first `limit` target moments with text the rights allow (ING-2), in the
    store's order, so two trials see the same moments."""
    if limit < 1:
        raise TrialError("the limit must be at least 1")  # 0 would mean every moment
    chosen: list[TrialMoment] = []
    for moment_id in store.questions.targets(None):
        target = store.questions.target(moment_id)
        text = moment_text(store, target)
        if target is None or not text:
            continue
        chosen.append(TrialMoment(moment_id, text, [n for _, n in target.concepts]))
        if len(chosen) == limit:
            break
    return chosen


def run_trial(
    gateway: AiGateway,
    model: str,
    moments: list[TrialMoment],
    sleep: Callable[[float], None] = time.sleep,
    timeout_s: float = TIMEOUT_S,
    draft_batch: str | None = None,
) -> TrialReport:
    """`draft_batch` resumes a draft batch already submitted (and paid for) for the
    same moments, instead of sending a new one.

    shortcut: the trial has no record of which batches it has costed, so resuming a
    batch a trial already collected records its cost in ai_usage twice; resume only
    one that no trial finished reading (the cost is logged with its id when recorded).
    Fine for a one-off comparison; give trials a batch table if they become routine."""
    report = TrialReport(model, len(moments))
    if not moments:
        return report
    by_id = {f"draft-{m.moment_id}": m for m in moments}
    drafted: list[tuple[TrialMoment, QuestionDraft]] = []
    for item in _batch(
        gateway,
        model,
        [BatchRequest(cid, prompt(m.text, m.concepts)) for cid, m in by_id.items()],
        report,
        sleep,
        timeout_s,
        draft_batch,
    ):
        moment = by_id.get(item.custom_id)
        if moment is None:
            continue  # a resumed batch for other moments: not this trial's
        if item.text is None:
            report.errors += 1
            continue
        try:
            drafts = parse_reply(item.text, moment.text)
        except QuestionReplyError as error:
            reason = str(error).split(":")[0]
            report.broken[reason] = report.broken.get(reason, 0) + 1
            continue
        report.drafted += 1
        drafted += [(moment, shuffled(d)) for d in drafts]
    report.missing = (
        report.moments - report.drafted - sum(report.broken.values()) - report.errors
    )
    if not drafted:
        return report
    answers: dict[str, int | None] = {}
    for item in _batch(
        gateway,
        model,
        [
            BatchRequest(f"validate-{i}", validation_prompt(m.text, d))
            for i, (m, d) in enumerate(drafted)
        ],
        report,
        sleep,
        timeout_s,
    ):
        if item.text is None:
            report.validation_errors += 1
            continue
        try:
            answers[item.custom_id] = parse_answer(item.text)
        except QuestionReplyError:
            report.validation_broken += 1
    for i, (moment, draft) in enumerate(drafted):
        # None: no usable answer (counted above), not a disagreement.
        answer = answers.get(f"validate-{i}")
        report.agreed += answer == draft.correct
        report.questions.append(
            TrialQuestion(
                moment.moment_id,
                draft.stem,
                draft.options,
                draft.correct,
                answer,
                draft.citation,
            )
        )
    return report


def _batch(
    gateway: AiGateway,
    model: str,
    requests: list[BatchRequest],
    report: TrialReport,
    sleep: Callable[[float], None],
    timeout_s: float,
    batch_id: str | None = None,
) -> list[BatchItem]:
    if batch_id is None:
        submitted = gateway.submit_batch(
            feature="questions", model=model, requests=requests
        )
        if isinstance(submitted, OverBudget):
            raise TrialError(f"over budget ({submitted.scope})")
        batch_id = submitted
    log.info("question trial: batch", batch_id=batch_id, model=model)
    deadline = time.monotonic() + timeout_s
    while True:
        try:
            status = gateway.batch_status(batch_id)
        except ModelError as error:
            # Not readable yet (OpenRouter's 404 just after submitting) or a balance
            # hold: read again until the deadline.
            log.warn(
                "question trial: batch not readable",
                batch_id=batch_id,
                error=str(error),
            )
            status = BatchStatus("running", [], None, None)
        if status.state == "failed":
            raise TrialError(f"batch {batch_id} failed: {status.error}")
        if status.state == "completed":
            break
        if time.monotonic() >= deadline:
            raise TrialError(f"batch {batch_id} still running after {timeout_s:.0f}s")
        sleep(POLL_S)
    if status.error is not None:
        report.notes.append(f"batch {batch_id} ended part way: {status.error}")
    gateway.record_batch_cost(feature="questions", model=model, status=status)
    assert status.cost_usd is not None  # record_batch_cost refuses one without
    log.info("question trial: cost recorded", batch_id=batch_id, cost=status.cost_usd)
    report.cost_usd += status.cost_usd
    report.input_tokens += sum(i.input_tokens for i in status.items)
    report.output_tokens += sum(i.output_tokens for i in status.items)
    return status.items
