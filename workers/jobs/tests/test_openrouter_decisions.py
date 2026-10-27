"""OpenRouter's Decisions API (Jev and other decision models): typed questions about a
state, typed answers with probabilities. httpx's mock transport plays OpenRouter."""

import json
from collections.abc import Callable
from decimal import Decimal

import httpx
import pytest

from interval_jobs.adapters.openrouter_decisions import URL, OpenRouterDecisions
from interval_jobs.ports import ChoiceAnswer, ModelError, NoulAnswer, ScoreAnswer

QUESTIONS: dict[str, object] = {
    "team": {
        "type": "choice",
        "instructions": "Which team should own this ticket?",
        "criteria": {"payments": "Billing issues", "frontend": "Layout issues"},
    },
    "urgency": {
        "type": "score",
        "instructions": "How urgent?",
        "criteria": ["Later", "This week", "Now"],
    },
}
ANSWER = {
    "answers": {
        "team": {
            "type": "choice",
            "choice": "payments",
            "confidence": 0.75,
            "probabilities": {"payments": 0.84, "frontend": 0.16},
        },
        "urgency": {"type": "score", "score": 1.99, "probabilities": {"2": 0.99}},
        "is_bug": {"type": "noul", "noul": 0.96},
    },
    "model": "typesafe/jev-1.14-20261014",
    "usage": {"cost": 0.000019992, "input_tokens": 476, "output_tokens": 70},
}


def client(
    handler: Callable[[httpx.Request], httpx.Response],
    price: Decimal | None = Decimal(0),
) -> OpenRouterDecisions:
    http = httpx.Client(transport=httpx.MockTransport(handler))
    return OpenRouterDecisions(
        http, "k", sleep=lambda _s: None, output_price=lambda _m: price
    )


def test_a_decision_sends_model_state_and_questions_and_reads_typed_answers() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=ANSWER)

    got = client(handler).decide(
        "typesafe/jev-1.14", {"ticket": "blank page"}, QUESTIONS
    )
    assert str(seen[0].url) == URL
    assert seen[0].headers["authorization"] == "Bearer k"
    assert json.loads(seen[0].content) == {
        "model": "typesafe/jev-1.14",
        "state": {"ticket": "blank page"},
        "questions": QUESTIONS,
    }
    team, urgency = got.answers["team"], got.answers["urgency"]
    assert isinstance(team, ChoiceAnswer) and isinstance(urgency, ScoreAnswer)
    assert team.choice == "payments"
    assert team.probabilities == {"payments": 0.84, "frontend": 0.16}
    assert urgency.score == 1.99
    assert got.answers["is_bug"] == NoulAnswer(0.96)
    assert (got.input_tokens, got.output_tokens) == (476, 70)
    assert got.cost_usd == Decimal("0.000019992")


def test_a_dear_or_unpriced_decision_model_is_refused_before_calling() -> None:
    called: list[int] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        called.append(1)
        return httpx.Response(200, json=ANSWER)

    with pytest.raises(ModelError, match="cap"):
        client(handler, price=Decimal("1.5")).decide("x/y", {}, QUESTIONS)
    with pytest.raises(ModelError, match="no output price"):
        client(handler, price=None).decide("x/y", {}, QUESTIONS)
    assert called == []


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(400, json={"error": {"message": "bad"}}),
        httpx.Response(200, json={"answers": {}, "model": "m"}),
        httpx.Response(200, text="not json"),
        # A response without its cost can't be budgeted (OPS-4): refused.
        httpx.Response(
            200,
            json={**ANSWER, "usage": {"input_tokens": 476, "output_tokens": 70}},
        ),
    ],
)
def test_failures_are_model_errors(response: httpx.Response) -> None:
    with pytest.raises(ModelError, match="decisions"):
        client(lambda _r: response).decide("x/y", {}, QUESTIONS)


def test_a_429_is_waited_out() -> None:
    replies = [httpx.Response(429), httpx.Response(200, json=ANSWER)]
    got = client(lambda _r: replies.pop(0)).decide("x/y", {}, QUESTIONS)
    assert isinstance(got.answers["team"], ChoiceAnswer)
