"""The one way to a model (ADR-0008, ADR-0007): every LLM and embedding call goes
through here, so each is costed and budgeted (OPS-4, LOAD-6, Q-P1-23).

Owner choices (2026-10-25): check the budget before the call and record the real cost
after it. Concurrent calls can overshoot by a few calls' cost. A refused call returns
OverBudget so the caller can degrade (LOAD-5); "ai: call" and "ai: over budget" log
lines carry the metrics (the AWS stack turns them into Interval/AI CostMicroUsd and
OverBudget).
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import ROUND_DOWN, Decimal
from typing import Literal

from interval_db.generated import AiFeature, AiProvider
from interval_jobs import log
from interval_jobs.ports import (
    AiLedger,
    BatchClient,
    BatchRequest,
    BatchStatus,
    DecisionAnswer,
    DecisionClient,
    DecisionState,
    EmbeddingClient,
    EmbeddingPurpose,
    LlmClient,
    Message,
    ModelError,
    Usage,
)

# Owner, 2026-10-28: "no limit on voyage embeddings" (its tokens cost the owner
# nothing). Their calls are still recorded, but never refused and never counted
# against a budget (OPS-4).
UNMETERED: frozenset[AiProvider] = frozenset({"voyage"})


@dataclass(frozen=True)
class OverBudget:
    scope: Literal["user", "global"]


@dataclass(frozen=True)
class Completed:
    text: str
    usage: Usage


@dataclass(frozen=True)
class Decided:
    answers: dict[str, DecisionAnswer]
    usage: Usage


@dataclass(frozen=True)
class Embedded:
    vectors: list[list[float]]
    usage: Usage


class AiGateway:
    def __init__(
        self,
        ledger: AiLedger,
        llm: LlmClient,
        embeddings: EmbeddingClient,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        *,
        others: Mapping[str, LlmClient] | None = None,
        decisions: DecisionClient | None = None,
        batches: BatchClient | None = None,
    ) -> None:
        self._ledger = ledger
        self._llm = llm
        # Other LLM providers by model prefix: "groq:", "google:" (ADR-0020, ADR-0021).
        self._others = others or {}
        # Decision models (OpenRouter's Decisions API): typed answers, not text.
        self._decisions = decisions
        # Batch tiers (Q-P2-13): half price, results later.
        self._batches = batches
        self._embeddings = embeddings
        self._clock = clock

    def complete(
        self,
        *,
        feature: AiFeature,
        user_id: str | None,
        model: str,
        messages: list[Message],
    ) -> Completed | OverBudget:
        refused = self._over_budget(feature, user_id)
        if refused is not None:
            return refused
        client, bare = self._route(model)
        result = client.complete(bare, messages)
        usage = self._record(
            feature,
            user_id,
            client.provider,
            bare,
            result.input_tokens,
            result.output_tokens,
            result.cost_usd,
        )
        return Completed(result.text, usage)

    def decide(
        self,
        *,
        feature: AiFeature,
        user_id: str | None,
        model: str,
        state: DecisionState,
        questions: dict[str, object],
    ) -> Decided | OverBudget:
        if self._decisions is None:
            raise ModelError("no decision-model client configured")
        refused = self._over_budget(feature, user_id)
        if refused is not None:
            return refused
        result = self._decisions.decide(model, state, questions)
        usage = self._record(
            feature,
            user_id,
            self._decisions.provider,
            model,
            result.input_tokens,
            result.output_tokens,
            result.cost_usd,
        )
        return Decided(result.answers, usage)

    def submit_batch(
        self,
        *,
        feature: AiFeature,
        model: str,
        requests: Sequence[BatchRequest],
    ) -> str | OverBudget:
        """Offline only. The budget is checked before submitting; nothing is paid
        until the batch completes (collect_batch records it)."""
        if self._batches is None:
            raise ModelError("no batch client configured")
        refused = self._over_budget(feature, None)
        if refused is not None:
            return refused
        return self._batches.submit(model, requests)

    def batch_status(self, batch_id: str) -> BatchStatus:
        """Reads a batch; records nothing (record_batch_cost does, once claimed)."""
        if self._batches is None:
            raise ModelError("no batch client configured")
        return self._batches.status(batch_id)

    def over_budget(self, feature: AiFeature, user_id: str | None) -> bool:
        """Whether the budget is spent: checked before a user's work joins a batch
        (OPS-4), since a batch is paid for only once it completes."""
        return self._over_budget(feature, user_id) is not None

    def record_batch_cost(
        self,
        *,
        feature: AiFeature,
        model: str,
        status: BatchStatus,
        payers: Mapping[str, tuple[AiFeature, str | None]] | None = None,
    ) -> None:
        """A finished batch's cost and tokens (OPS-4). The caller claims the batch
        first so a retried collection never records it twice. `payers` names, by
        custom_id, the feature and user a request is charged to (Q-P2-46: project
        notes go to their user); the rest go to `feature`, globally. The cost is
        split by each group's tokens."""
        if self._batches is None:
            raise ModelError("no batch client configured")
        if status.cost_usd is None:
            raise ModelError("a finished batch without a cost can't be recorded")
        groups: dict[tuple[AiFeature, str | None], list[int]] = {}
        for item in status.items:
            key = (payers or {}).get(item.custom_id, (feature, None))
            tokens = groups.setdefault(key, [0, 0])
            tokens[0] += item.input_tokens
            tokens[1] += item.output_tokens
        total = sum(i + o for i, o in groups.values())
        global_key: tuple[AiFeature, str | None] = (feature, None)
        recorded = Decimal(0)
        for key, (in_tokens, out_tokens) in groups.items():
            if key == global_key:
                continue
            # Rounded down, so the shares never exceed the cost; the global
            # group takes the remainder, never a user.
            share = (
                (status.cost_usd * (in_tokens + out_tokens) / total).quantize(
                    Decimal("0.000001"), rounding=ROUND_DOWN
                )
                if total
                else Decimal(0)
            )
            recorded += share
            self._record(
                key[0],
                key[1],
                self._batches.provider,
                model,
                in_tokens,
                out_tokens,
                share,
            )
        remainder = status.cost_usd - recorded
        if global_key not in groups and not remainder:
            return  # every request had its payer, and nothing was left over
        in_tokens, out_tokens = groups.get(global_key, [0, 0])
        self._record(
            feature,
            None,
            self._batches.provider,
            model,
            in_tokens,
            out_tokens,
            remainder,
        )

    def embed(
        self,
        *,
        feature: AiFeature,
        user_id: str | None,
        model: str,
        texts: list[str],
        purpose: EmbeddingPurpose,
    ) -> Embedded | OverBudget:
        if self._embeddings.provider not in UNMETERED:
            refused = self._over_budget(feature, user_id)
            if refused is not None:
                return refused
        result = self._embeddings.embed(model, texts, purpose)
        usage = self._record(
            feature,
            user_id,
            self._embeddings.provider,
            model,
            result.input_tokens,
            0,
            result.cost_usd,
        )
        return Embedded(result.vectors, usage)

    def _route(self, model: str) -> tuple[LlmClient, str]:
        # "groq:"/"google:" pick that provider; "openrouter:" or a bare id (which may
        # itself hold a colon, as in "vendor/model:free") is OpenRouter.
        prefix, _, bare = model.partition(":")
        if bare and prefix in ("groq", "google"):
            client = self._others.get(prefix)
            if client is None:
                raise ModelError(f"no {prefix} client: is its API key set?")
            return client, bare
        if bare and prefix == "openrouter":
            return self._llm, bare
        return self._llm, model

    def _over_budget(
        self, feature: AiFeature, user_id: str | None
    ) -> OverBudget | None:
        budget_cents = self._ledger.daily_budget_cents(user_id)
        if budget_cents is None:
            return None
        spent = self._ledger.spent_usd(
            user_id, self._clock().astimezone(UTC).date(), excluding=UNMETERED
        )
        if spent * 100 < budget_cents:
            return None
        scope: Literal["user", "global"] = "global" if user_id is None else "user"
        log.warn("ai: over budget", scope=scope, feature=feature, user_id=user_id)
        return OverBudget(scope)

    def _record(
        self,
        feature: AiFeature,
        user_id: str | None,
        provider: AiProvider,
        model: str,
        input_tokens: int,
        output_tokens: int,
        cost_usd: Decimal,
    ) -> Usage:
        usage = Usage(
            user_id=user_id,
            feature=feature,
            provider=provider,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=cost_usd,
            occurred_at=self._clock(),
        )
        self._ledger.record(usage)
        # Whole micro-dollars: the AWS metric filter sums this field, and an integer
        # never turns into exponent notation the way a small float does (1.25e-05).
        log.info(
            "ai: call",
            feature=feature,
            provider=provider,
            model=model,
            cost_micro_usd=int(cost_usd * 1_000_000),
            user_id=user_id,
        )
        return usage
