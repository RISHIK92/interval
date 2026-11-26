"""ADR-0046 (AI-5): the Ask eval passes at 90% with no rights failure, needs 30 real
questions, and never runs a placeholder. A fake answer path stands in for the model."""

from collections.abc import Callable
from pathlib import Path

import pytest

from interval_jobs.ask_eval import (
    EvalError,
    EvalQuestion,
    parse_questions,
    run_eval,
)
from interval_jobs.ports import AskRequest, AskResult

EVALS = Path(__file__).resolve().parents[1] / "evals"


def test_the_shipped_file_has_only_placeholders() -> None:
    path = EVALS / "ask.yaml"
    assert parse_questions(path.read_text(encoding="utf-8"), str(path)) == []


def test_questions_are_checked_as_parsed() -> None:
    good = parse_questions(
        "questions:\n"
        "  - {question: ' Why shard? ', expect: answer, chip: explain_new}\n"
        "  - {question: x, expect: answer, placeholder: true}\n",
        "f",
    )
    assert good == [EvalQuestion("Why shard?", "answer", "explain_new")]
    for bad in (
        "questions: {}",
        "questions:\n  - {question: '', expect: answer}",
        "questions:\n  - {question: q, expect: maybe}",
        "questions:\n  - {question: q, expect: answer, chip: poem}",
    ):
        with pytest.raises(EvalError):
            parse_questions(bad, "f")


def _questions(n: int) -> list[EvalQuestion]:
    return [
        EvalQuestion(f"q{i}", "nothing" if i % 10 == 0 else "answer") for i in range(n)
    ]


def _fake(
    wrong: set[str], refused: str | None = None
) -> Callable[[AskRequest], AskResult]:
    def answer(request: AskRequest) -> AskResult:
        # q0, q10, q20: the questions nothing covers.
        outcome = "nothing_found" if request.text.endswith("0") else "answered"
        if request.text in wrong:
            return AskResult("unavailable", refused=refused)
        return AskResult(outcome)

    return answer


def test_fewer_than_30_questions_is_refused() -> None:
    with pytest.raises(EvalError, match="at least 30"):
        run_eval(_fake(set()), _questions(29), "u1", "intermediate")


def test_passes_at_90_percent_and_fails_below() -> None:
    three = run_eval(_fake({"q1", "q2", "q3"}), _questions(30), "u1", "beginner")
    assert (three.passed_count, three.passed) == (27, True)
    four = run_eval(_fake({"q1", "q2", "q3", "q4"}), _questions(30), "u1", "beginner")
    assert (four.passed_count, four.passed) == (26, False)


def test_one_rights_failure_fails_the_eval() -> None:
    report = run_eval(
        _fake({"q1"}, refused="copies source text"), _questions(30), "u1", "beginner"
    )
    assert report.pass_rate > 0.9
    assert (report.rights_failures, report.passed) == (1, False)


def test_each_question_runs_as_the_named_user_without_storing() -> None:
    seen: list[AskRequest] = []

    def answer(request: AskRequest) -> AskResult:
        seen.append(request)
        return AskResult("answered")

    run_eval(answer, _questions(30), "owner", "advanced")
    assert {r.user_id for r in seen} == {"owner"}
    assert {r.level for r in seen} == {"advanced"}
    assert len({r.question_id for r in seen}) == 30
