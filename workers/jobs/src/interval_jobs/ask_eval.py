"""The Ask eval (ADR-0046, AI-5): `eval-ask` runs the owner's questions through the
stage's own answer path (retrieval, ASK_MODEL, the validator), stores nothing, and
passes only when at least 90% of questions get the expected outcome and no answer
breaks a rights rule. Ask stays off (ASK_MODEL unset) until it passes, and it runs
again on every prompt or model change."""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Literal, cast

import yaml

from interval_db.generated import Difficulty
from interval_jobs.ports import AskChip, AskRequest, AskResult

MIN_QUESTIONS = 30  # ADR-0046
PASS_RATE = 0.9  # ADR-0046: launch at 90% or more overall
# The validator's refusals that are rights rules (AI-1, AI-3, ING-2): 100% required.
RIGHTS_REFUSALS = frozenset(
    {"copies source text", "a citation outside the retrieved passages"}
)
CHIPS: frozenset[str] = frozenset(
    {"compare", "explain_new", "interview_drill", "my_stack"}
)

type Expect = Literal["answer", "nothing"]


class EvalError(Exception):
    pass


@dataclass(frozen=True)
class EvalQuestion:
    text: str
    expect: Expect  # "nothing": nothing in the catalogue covers it, no model call
    chip: AskChip | None = None


@dataclass(frozen=True)
class QuestionResult:
    text: str
    expect: Expect
    outcome: str
    refused: str | None
    passed: bool


@dataclass(frozen=True)
class AskEvalReport:
    questions: int
    passed_count: int
    rights_failures: int
    pass_rate: float
    passed: bool
    results: list[QuestionResult]


def parse_questions(text: str, path: str) -> list[EvalQuestion]:
    """The questions file; entries marked `placeholder: true` are examples of the
    format and are never run."""
    loaded: object = yaml.safe_load(text)
    if not isinstance(loaded, dict):
        raise EvalError(f"{path}: expected a mapping with `questions`")
    raw = cast(dict[str, object], loaded).get("questions")
    if not isinstance(raw, list):
        raise EvalError(f"{path}: `questions` must be a list")
    questions: list[EvalQuestion] = []
    for n, entry in enumerate(cast(list[object], raw), start=1):
        if not isinstance(entry, dict):
            raise EvalError(f"{path}: question {n} is not a mapping")
        fields = cast(dict[str, object], entry)
        if fields.get("placeholder") is True:
            continue
        question, expect, chip = (
            fields.get("question"),
            fields.get("expect"),
            fields.get("chip"),
        )
        if not isinstance(question, str) or not 1 <= len(question.strip()) <= 300:
            raise EvalError(f"{path}: question {n} needs 1-300 characters of text")
        if expect not in ("answer", "nothing"):
            raise EvalError(f"{path}: question {n}: expect is answer or nothing")
        if chip is not None and chip not in CHIPS:
            raise EvalError(f"{path}: question {n}: unknown chip {chip!r}")
        questions.append(
            EvalQuestion(
                question.strip(),
                expect,
                cast(AskChip | None, chip),
            )
        )
    return questions


def run_eval(
    answer: Callable[[AskRequest], AskResult],
    questions: Sequence[EvalQuestion],
    user_id: str,
    level: Difficulty,
) -> AskEvalReport:
    """`answer` is the stage's own path (Pipeline.answer); `user_id` names whose
    hidden sources and catalogue the questions run against."""
    if len(questions) < MIN_QUESTIONS:
        raise EvalError(
            f"the Ask eval needs at least {MIN_QUESTIONS} questions; "
            f"the file has {len(questions)} (placeholders don't count)"
        )
    results: list[QuestionResult] = []
    for n, q in enumerate(questions, start=1):
        result = answer(
            AskRequest(
                question_id=f"eval-{n}",
                user_id=user_id,
                is_guest=False,
                beta_group=None,
                text=q.text,
                chip=q.chip,
                level=level,
                technologies=[],
                thread=[],
            )
        )
        wanted = "answered" if q.expect == "answer" else "nothing_found"
        results.append(
            QuestionResult(
                q.text,
                q.expect,
                result.outcome,
                result.refused,
                result.outcome == wanted,
            )
        )
    passed_count = sum(r.passed for r in results)
    rights = sum(r.refused in RIGHTS_REFUSALS for r in results)
    rate = passed_count / len(results)
    return AskEvalReport(
        questions=len(results),
        passed_count=passed_count,
        rights_failures=rights,
        pass_rate=rate,
        passed=rate >= PASS_RATE and rights == 0,
        results=results,
    )
