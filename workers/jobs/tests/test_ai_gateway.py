"""Every model call goes through the gateway (ADR-0008), which keeps budgets (OPS-4)."""

import json
from collections.abc import Sequence
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import pytest

from interval_db.generated import AiProvider
from interval_jobs.adapters.memory import InMemoryAi, InMemoryStore, StoredUser
from interval_jobs.ai.gateway import (
    AiGateway,
    Completed,
    Decided,
    Embedded,
    OverBudget,
)
from interval_jobs.ports import (
    BatchItem,
    BatchRequest,
    BatchStatus,
    ChoiceAnswer,
    Completion,
    Decision,
    DecisionState,
    EmbeddingPurpose,
    Embeddings,
    Message,
    ModelError,
    Usage,
)

NOW = datetime(2026, 10, 25, 12, 0, tzinfo=UTC)
MESSAGES: list[Message] = [{"role": "user", "content": "tag this"}]


class FakeLlm:
    provider: AiProvider = "openrouter"

    def __init__(self, cost: str = "0.01", error: Exception | None = None) -> None:
        self.calls = 0
        self._cost = Decimal(cost)
        self._error = error

    def complete(self, model: str, messages: list[Message]) -> Completion:
        self.calls += 1
        if self._error is not None:
            raise self._error
        return Completion(
            text="tags", input_tokens=100, output_tokens=20, cost_usd=self._cost
        )


class FakeEmbeddings:
    provider: AiProvider = "voyage"

    def __init__(self) -> None:
        self.calls = 0

    def embed(
        self, model: str, texts: list[str], purpose: EmbeddingPurpose
    ) -> Embeddings:
        self.calls += 1
        return Embeddings(
            vectors=[[0.1, 0.2] for _ in texts],
            input_tokens=8,
            cost_usd=Decimal("0.0001"),
        )


@pytest.fixture
def ledger() -> InMemoryAi:
    memory = InMemoryStore()
    memory.users.rows["u1"] = StoredUser("u1", is_anonymous=False, email="u1@x.test")
    return InMemoryAi(memory.users)


def gateway(ledger: InMemoryAi, llm: FakeLlm | None = None) -> AiGateway:
    return AiGateway(ledger, llm or FakeLlm(), FakeEmbeddings(), clock=lambda: NOW)


def spend(
    ledger: InMemoryAi,
    user_id: str | None,
    cost: str,
    at: datetime,
    provider: AiProvider = "openrouter",
) -> None:
    ledger.record(
        Usage(
            user_id=user_id,
            feature="tagging",
            provider=provider,
            model="m",
            input_tokens=0,
            output_tokens=0,
            cost_usd=Decimal(cost),
            occurred_at=at,
        )
    )


def logged(capsys: pytest.CaptureFixture[str], msg: str) -> list[dict[str, Any]]:
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    return [line for line in lines if line["msg"] == msg]


def test_a_call_under_budget_is_made_recorded_and_logged_with_its_cost(
    ledger: InMemoryAi, capsys: pytest.CaptureFixture[str]
) -> None:
    llm = FakeLlm(cost="0.012")
    result = gateway(ledger, llm).complete(
        feature="tagging", user_id="u1", model="small", messages=MESSAGES
    )
    assert isinstance(result, Completed)
    assert result.text == "tags"
    assert llm.calls == 1
    assert ledger.rows == [result.usage]
    assert result.usage.cost_usd == Decimal("0.012")
    assert result.usage.occurred_at == NOW
    [line] = logged(capsys, "ai: call")
    assert line["cost_micro_usd"] == 12_000
    assert line["feature"] == "tagging"


def test_a_user_at_their_daily_budget_gets_over_budget_and_no_call(
    ledger: InMemoryAi, capsys: pytest.CaptureFixture[str]
) -> None:
    spend(ledger, "u1", "0.50", NOW)  # the beta plan's 50 cents
    llm = FakeLlm()
    result = gateway(ledger, llm).complete(
        feature="notes", user_id="u1", model="small", messages=MESSAGES
    )
    assert result == OverBudget("user")
    assert llm.calls == 0
    assert len(ledger.rows) == 1  # only the earlier spend
    [line] = logged(capsys, "ai: over budget")
    assert line["scope"] == "user"
    assert line["feature"] == "notes"


def test_yesterdays_spend_does_not_count(ledger: InMemoryAi) -> None:
    spend(ledger, "u1", "5.00", datetime(2026, 10, 24, 23, 59, tzinfo=UTC))
    result = gateway(ledger).complete(
        feature="tagging", user_id="u1", model="small", messages=MESSAGES
    )
    assert isinstance(result, Completed)


def test_offline_calls_use_the_global_budget_only(ledger: InMemoryAi) -> None:
    spend(
        ledger, "u1", "4.99", NOW
    )  # user spend never counts against the global budget
    assert isinstance(
        gateway(ledger).complete(
            feature="tagging", user_id=None, model="small", messages=MESSAGES
        ),
        Completed,
    )
    spend(ledger, None, "5.00", NOW)
    assert gateway(ledger).complete(
        feature="tagging", user_id=None, model="small", messages=MESSAGES
    ) == OverBudget("global")


def test_a_failed_call_records_nothing_and_propagates(ledger: InMemoryAi) -> None:
    llm = FakeLlm(error=TimeoutError("provider timed out"))
    with pytest.raises(TimeoutError):
        gateway(ledger, llm).complete(
            feature="tagging", user_id="u1", model="small", messages=MESSAGES
        )
    assert ledger.rows == []


# Owner, 2026-10-28: "no limit on voyage embeddings" (its tokens cost the owner
# nothing). Voyage calls are recorded, never refused, and don't count toward a budget.
def test_voyage_embeddings_are_never_refused_and_never_spend_a_budget(
    ledger: InMemoryAi,
) -> None:
    result = gateway(ledger).embed(
        feature="embeddings",
        user_id=None,
        model="voyage-x",
        texts=["a", "b"],
        purpose="document",
    )
    assert isinstance(result, Embedded)
    assert len(result.vectors) == 2
    assert result.usage.provider == "voyage"
    assert result.usage.output_tokens == 0
    spend(ledger, None, "5.00", NOW)
    assert isinstance(
        gateway(ledger).embed(
            feature="embeddings",
            user_id=None,
            model="voyage-x",
            texts=["a"],
            purpose="query",
        ),
        Embedded,
    )
    # And Voyage's own spend leaves the budget to the other providers.
    fresh = InMemoryAi(InMemoryStore().users)
    spend(fresh, None, "50.00", NOW, provider="voyage")
    assert isinstance(
        gateway(fresh).complete(
            feature="tagging", user_id=None, model="small", messages=MESSAGES
        ),
        Completed,
    )


class UnlimitedLedger(InMemoryAi):
    def daily_budget_cents(self, user_id: str | None) -> int | None:
        return None


def test_no_limit_means_the_call_is_never_refused(ledger: InMemoryAi) -> None:
    unlimited = UnlimitedLedger(InMemoryStore().users)
    spend(unlimited, "u1", "1000.00", NOW)
    result = AiGateway(
        unlimited, FakeLlm(), FakeEmbeddings(), clock=lambda: NOW
    ).complete(feature="tagging", user_id="u1", model="small", messages=MESSAGES)
    assert isinstance(result, Completed)


def test_a_user_without_a_budget_grant_is_refused_before_spending_anything() -> None:
    no_plan = InMemoryAi(InMemoryStore().users)  # "nobody" has no plan grant: 0 cents
    llm = FakeLlm()
    result = AiGateway(no_plan, llm, FakeEmbeddings(), clock=lambda: NOW).complete(
        feature="tagging", user_id="nobody", model="small", messages=MESSAGES
    )
    assert result == OverBudget("user")
    assert llm.calls == 0


def test_a_spent_global_budget_does_not_block_users(ledger: InMemoryAi) -> None:
    spend(ledger, None, "5.00", NOW)
    result = gateway(ledger).complete(
        feature="notes", user_id="u1", model="small", messages=MESSAGES
    )
    assert isinstance(result, Completed)


def test_spend_just_under_the_budget_still_allows_a_call(ledger: InMemoryAi) -> None:
    spend(ledger, "u1", "0.49", NOW)  # one cent under the beta plan's 50
    result = gateway(ledger).complete(
        feature="tagging", user_id="u1", model="small", messages=MESSAGES
    )
    assert isinstance(result, Completed)


class FakeGroq(FakeLlm):
    provider: AiProvider = "groq"

    def __init__(self) -> None:
        super().__init__()
        self.models: list[str] = []

    def complete(self, model: str, messages: list[Message]) -> Completion:
        self.models.append(model)
        return super().complete(model, messages)


def test_a_groq_prefix_routes_the_call_and_records_groq(ledger: InMemoryAi) -> None:
    # ADR-0020: the model setting names the provider; a bare id stays OpenRouter.
    openrouter, groq = FakeLlm(), FakeGroq()
    gate = AiGateway(
        ledger, openrouter, FakeEmbeddings(), clock=lambda: NOW, others={"groq": groq}
    )
    result = gate.complete(
        feature="tagging",
        user_id=None,
        model="groq:openai/gpt-oss-120b",
        messages=MESSAGES,
    )
    assert isinstance(result, Completed)
    assert groq.models == ["openai/gpt-oss-120b"]
    assert openrouter.calls == 0
    assert (result.usage.provider, result.usage.model) == (
        "groq",
        "openai/gpt-oss-120b",
    )
    named = gate.complete(
        feature="tagging", user_id=None, model="openrouter:x/y", messages=MESSAGES
    )
    assert isinstance(named, Completed)
    assert (named.usage.provider, named.usage.model) == ("openrouter", "x/y")
    assert openrouter.calls == 1


def test_a_groq_model_without_a_groq_client_is_a_model_error(
    ledger: InMemoryAi,
) -> None:
    with pytest.raises(ModelError, match="groq"):
        gateway(ledger).complete(
            feature="tagging", user_id=None, model="groq:m", messages=MESSAGES
        )
    assert ledger.rows == []


class FakeDecisions:
    provider: AiProvider = "openrouter"

    def __init__(self) -> None:
        self.calls = 0

    def decide(
        self, model: str, state: DecisionState, questions: dict[str, object]
    ) -> Decision:
        self.calls += 1
        return Decision(
            {"team": ChoiceAnswer("payments", {"payments": 0.9})},
            input_tokens=400,
            output_tokens=0,
            cost_usd=Decimal("0.00002"),
        )


def test_a_decision_is_budgeted_and_recorded_like_any_call(ledger: InMemoryAi) -> None:
    decisions = FakeDecisions()
    gate = AiGateway(
        ledger, FakeLlm(), FakeEmbeddings(), clock=lambda: NOW, decisions=decisions
    )
    result = gate.decide(
        feature="tagging",
        user_id="u1",
        model="typesafe/jev-1.14",
        state={},
        questions={},
    )
    assert isinstance(result, Decided)
    assert result.answers["team"] == ChoiceAnswer("payments", {"payments": 0.9})
    assert ledger.rows == [result.usage]
    assert (result.usage.provider, result.usage.model) == (
        "openrouter",
        "typesafe/jev-1.14",
    )
    spend(ledger, "u1", "0.50", NOW)
    assert gate.decide(
        feature="tagging", user_id="u1", model="m", state={}, questions={}
    ) == OverBudget("user")
    assert decisions.calls == 1


def test_a_decision_without_a_decisions_client_is_a_model_error(
    ledger: InMemoryAi,
) -> None:
    with pytest.raises(ModelError, match="decision"):
        gateway(ledger).decide(
            feature="tagging", user_id=None, model="m", state={}, questions={}
        )


# Q-P2-13 (P2-W8-S05): a batch is budgeted before it's submitted and costed once, when
# it completes.
class FakeBatches:
    provider: AiProvider = "openrouter"

    def __init__(self, state: BatchStatus) -> None:
        self.state = state
        self.submitted: list[list[BatchRequest]] = []

    def submit(self, model: str, requests: Sequence[BatchRequest]) -> str:
        self.submitted.append(list(requests))
        return "batch_1"

    def status(self, batch_id: str) -> BatchStatus:
        return self.state


def batch_gateway(ledger: InMemoryAi, batches: FakeBatches) -> AiGateway:
    return AiGateway(
        ledger, FakeLlm(), FakeEmbeddings(), clock=lambda: NOW, batches=batches
    )


def test_a_batch_is_refused_over_the_global_budget_and_otherwise_submitted(
    ledger: InMemoryAi,
) -> None:
    batches = FakeBatches(BatchStatus("running", [], None, None))
    requests = [BatchRequest("draft-1", MESSAGES)]
    got = batch_gateway(ledger, batches).submit_batch(
        feature="questions", model="m", requests=requests
    )
    assert got == "batch_1" and batches.submitted == [requests]
    assert ledger.rows == []  # nothing is paid until it completes
    spend(ledger, None, "5.00", NOW)
    assert batch_gateway(ledger, batches).submit_batch(
        feature="questions", model="m", requests=requests
    ) == OverBudget("global")
    assert len(batches.submitted) == 1


def test_reading_a_batch_records_nothing_and_its_cost_is_recorded_when_asked(
    ledger: InMemoryAi,
) -> None:
    done = BatchStatus(
        "completed",
        [
            BatchItem("a", "x", None, 1000, 200),
            BatchItem("b", None, "overloaded", 0, 0),
        ],
        Decimal("0.0001"),
        None,
    )
    gateway = batch_gateway(ledger, FakeBatches(done))
    assert gateway.batch_status("batch_1") == done
    assert ledger.rows == []
    gateway.record_batch_cost(feature="questions", model="m", status=done)
    (row,) = ledger.rows
    assert (row.feature, row.user_id, row.model) == ("questions", None, "m")
    assert (row.input_tokens, row.output_tokens) == (1000, 200)
    assert row.cost_usd == Decimal("0.0001")
    with pytest.raises(ModelError, match="without a cost"):
        gateway.record_batch_cost(
            feature="questions",
            model="m",
            status=BatchStatus("completed", [], None, None),
        )
