"""The weekly recalibration (Q-3, Q-P2-19, P2-W9-S08) on the in-memory store: levels
from a Rasch fit once a question has 30 answers, and anomalies pulled for review."""

import random

import pytest

from interval_jobs.adapters.memory import InMemoryStore
from interval_jobs.irt import Answer
from interval_jobs.ports import QuestionDraft
from interval_jobs.recalibration import MIN_ANSWERS, recalibrate

DRAFT = QuestionDraft("Q?", ("a", "b", "c", "d"), 0, "a b c")


def bank(store: InMemoryStore, n: int) -> list[int]:
    ids: list[int] = []
    for i in range(n):
        ids += store.questions.save(
            100 + i, [DRAFT, DRAFT], ["c"], "m", 1, f"h{i}", "intermediate"
        )
    for qid in ids:
        store.questions.record_verdict(qid, "v", 0)  # live
    return ids


def answer(
    store: InMemoryStore, people: int, qid: int, right_share: float, seed: int
) -> None:
    rng = random.Random(seed)
    for p in range(people):
        store.questions.answers.append(Answer(f"u{p}", qid, rng.random() < right_share))


def test_levels_follow_real_answers_once_there_are_enough() -> None:
    store = InMemoryStore()
    easy, mid, hard, few = bank(store, 2)
    answer(store, 60, easy, 0.92, 1)
    answer(store, 60, mid, 0.55, 2)
    answer(store, 60, hard, 0.25, 3)
    answer(store, MIN_ANSWERS - 1, few, 0.05, 4)  # too few to judge yet
    got = recalibrate(store.questions)
    levels = {q.id: q.difficulty for q in store.questions.rows}
    assert levels[easy] == "beginner"
    assert levels[mid] == "intermediate"
    assert levels[hard] == "advanced"
    assert levels[few] == "intermediate"  # its starting level stands
    assert got.recalibrated == 3


def test_almost_always_right_or_wrong_is_pulled_for_review() -> None:
    store = InMemoryStore()
    ids = bank(store, 3)
    trivial, impossible, fine, scarce = ids[0], ids[1], ids[2], ids[3]
    answer(store, 50, trivial, 1.0, 1)  # everyone right
    answer(store, 50, impossible, 0.1, 2)
    answer(store, 50, fine, 0.6, 3)
    answer(store, 10, scarce, 1.0, 4)  # too few answers to call it odd
    got = recalibrate(store.questions)
    assert got.anomalies == 2
    queued = {q for q, reason, _ in store.questions.reviews if reason == "anomaly"}
    assert queued == {trivial, impossible}
    # Run again next week: not queued twice.
    assert recalibrate(store.questions).anomalies == 0


def test_no_answers_changes_nothing() -> None:
    store = InMemoryStore()
    bank(store, 1)
    got = recalibrate(store.questions)
    assert (got.recalibrated, got.anomalies) == (0, 0)


def test_everyone_right_or_wrong_with_enough_answers_still_gets_a_level() -> None:
    store = InMemoryStore()
    trivial, impossible, fine, other = bank(store, 2)
    answer(store, 40, trivial, 1.0, 1)
    answer(store, 40, impossible, 0.0, 2)
    answer(store, 40, fine, 0.6, 3)
    answer(store, 40, other, 0.4, 4)
    recalibrate(store.questions)
    levels = {q.id: q.difficulty for q in store.questions.rows}
    assert (levels[trivial], levels[impossible]) == ("beginner", "advanced")
    assert all(
        q.calibrated_at is not None
        for q in store.questions.rows
        if q.id in (trivial, impossible, fine, other)
    )


def test_a_fit_that_does_not_settle_changes_no_level_and_says_so(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    store = InMemoryStore()
    ids = bank(store, 2)
    for i, qid in enumerate(ids):
        answer(store, 40, qid, 0.3 + 0.1 * i, i)
    monkeypatch.setattr("interval_jobs.irt.MAX_ITERATIONS", 1)
    got = recalibrate(store.questions)
    assert got.recalibrated == 0
    assert got.converged is False
    assert {q.difficulty for q in store.questions.rows} == {"intermediate"}
    assert "recalibration: fit did not settle" in capsys.readouterr().out
