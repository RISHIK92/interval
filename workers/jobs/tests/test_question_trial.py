"""A question trial (Q-P2-13): the same few moments drafted and validated by one
batch model, reported side by side with another, with nothing saved to the bank."""

from decimal import Decimal

import pytest

from interval_jobs.ports import BatchStatus, ModelError
from interval_jobs.question_trial import TrialError, run_trial, trial_moments

from .test_question_batches import MODEL, batch_setup


def test_a_trial_drafts_then_validates_and_reports_without_saving() -> None:
    store, gateway, batches, ledger = batch_setup()
    moments = trial_moments(store, 1)
    assert len(moments) == 1
    report = run_trial(gateway, MODEL, moments, sleep=lambda _s: None)
    assert report.moments == 1 and report.drafted == 1 and report.broken == {}
    assert len(report.questions) == 2
    assert report.agreed == 2
    assert all(q.options[q.key] == "It" for q in report.questions)
    # Two batches (drafts, validations), each cost recorded once.
    assert len(batches.submitted) == 2
    assert report.cost_usd == Decimal("0.0002")
    assert [u.cost_usd for u in ledger.rows] == [Decimal("0.0001")] * 2
    assert store.questions.rows == []


def test_a_trial_names_why_replies_broke_and_counts_disagreement() -> None:
    store, gateway, batches, _ = batch_setup()
    moments = trial_moments(store, 2)
    batches.mode = "broken"
    report = run_trial(gateway, MODEL, moments, sleep=lambda _s: None)
    assert report.drafted == 0 and sum(report.broken.values()) == len(moments)
    assert report.questions == []
    batches.mode = "good"
    batches.wrong_answers = True
    report = run_trial(gateway, MODEL, moments, sleep=lambda _s: None)
    assert report.agreed == 0 and len(report.questions) == 2 * len(moments)
    assert report.validation_broken == 0 and report.validation_errors == 0


def test_a_trial_needs_a_positive_limit_and_sends_nothing_for_no_moments() -> None:
    store, gateway, batches, _ = batch_setup()
    with pytest.raises(TrialError, match="at least 1"):
        trial_moments(store, 0)
    assert run_trial(gateway, MODEL, [], sleep=lambda _s: None).moments == 0
    assert batches.submitted == {}


def test_a_failed_or_slow_batch_stops_the_trial() -> None:
    store, gateway, batches, _ = batch_setup()
    moments = trial_moments(store, 1)
    batches.mode = "failed"
    with pytest.raises(TrialError, match="failed"):
        run_trial(gateway, MODEL, moments, sleep=lambda _s: None)
    batches.mode = "running"
    with pytest.raises(TrialError, match="still running"):
        run_trial(gateway, MODEL, moments, sleep=lambda _s: None, timeout_s=0)


def test_a_trial_waits_out_an_unreadable_batch_and_can_resume_one() -> None:
    store, gateway, batches, ledger = batch_setup()
    moments = trial_moments(store, 1)
    reads = {"n": 0}
    real = batches.status

    def flaky(batch_id: str) -> BatchStatus:
        reads["n"] += 1
        if reads["n"] == 1:
            raise ModelError("not found yet")
        return real(batch_id)

    batches.status = flaky  # type: ignore[method-assign]
    report = run_trial(gateway, MODEL, moments, sleep=lambda _s: None)
    assert report.drafted == 1 and report.agreed == 2
    # Resuming a submitted draft batch sends no new draft batch.
    submitted = len(batches.submitted)
    resumed = run_trial(
        gateway, MODEL, moments, sleep=lambda _s: None, draft_batch="batch_1"
    )
    assert resumed.drafted == 1
    assert len(batches.submitted) == submitted + 1  # only the validation batch
    # Resuming a batch an earlier trial collected records it again (the shortcut
    # run_trial names): 2 batches, then the resumed draft and a new validation.
    assert len(ledger.rows) == 4
