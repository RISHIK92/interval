"""Every model call goes through the gateway (ADR-0008), which keeps budgets (OPS-4)."""

import json
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import pytest

from interval_db.generated import AiProvider
from interval_jobs.adapters.memory import InMemoryAi, InMemoryStore, StoredUser
from interval_jobs.ai.gateway import AiGateway, Completed, Embedded, OverBudget
from interval_jobs.ports import Completion, EmbeddingPurpose, Embeddings, Message, Usage

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


def spend(ledger: InMemoryAi, user_id: str | None, cost: str, at: datetime) -> None:
    ledger.record(
        Usage(
            user_id=user_id,
            feature="tagging",
            provider="openrouter",
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


def test_embeddings_follow_the_same_budget_rules(ledger: InMemoryAi) -> None:
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
    assert gateway(ledger).embed(
        feature="embeddings",
        user_id=None,
        model="voyage-x",
        texts=["a"],
        purpose="query",
    ) == OverBudget("global")


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
