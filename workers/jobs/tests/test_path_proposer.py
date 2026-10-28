"""The path proposer (§5F, Q-P2-24, Q-P2-25, P2-W10-S01): candidates from the model,
each ordered by prerequisites, sessions picked, drafts saved. A scripted model and a
stub store; every call goes through the gateway (ADR-0008)."""

import json
from collections.abc import Callable, Collection, Generator
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal

from interval_db.generated import AiProvider
from interval_jobs.adapters.memory import InMemoryAi, InMemoryStore
from interval_jobs.ai.gateway import AiGateway
from interval_jobs.path_proposer import propose
from interval_jobs.ports import (
    Completion,
    ConceptCoverage,
    Message,
    PathDraft,
    SessionCandidate,
)

from .test_ai_gateway import FakeEmbeddings, spend

NOW = datetime(2026, 10, 28, 12, tzinfo=UTC)


class ScriptedLlm:
    provider: AiProvider = "openrouter"

    def __init__(self, replies: list[str]) -> None:
        self.replies = replies
        self.asked: list[list[Message]] = []

    def complete(self, model: str, messages: list[Message]) -> Completion:
        self.asked.append(messages)
        return Completion(self.replies.pop(0), 500, 200, Decimal("0.0001"))


@dataclass
class StubPaths:
    saved: list[PathDraft] = field(default_factory=list[PathDraft])

    def coverage(self) -> list[ConceptCoverage]:
        return [
            ConceptCoverage(s, s.upper(), "backend", 3, 2)
            for s in ("tcp", "http", "tls", "cdn", "dns")
        ]

    def prerequisites(self) -> set[tuple[str, str]]:
        return {("tcp", "http"), ("tcp", "tls"), ("http", "cdn")}

    def session_candidates(self, slugs: Collection[str]) -> list[SessionCandidate]:
        pool = {
            "tcp": [1, 2],
            "http": [3, 13],
            "tls": [4, 14],
            "cdn": [5, 15],
            "dns": [6, 16],
        }
        return [
            SessionCandidate(m, frozenset({s}), m, True, True)
            for s in slugs
            for m in pool.get(s, [])
        ]

    def save_draft(self, draft: PathDraft, model: str, prompt_version: int) -> int:
        self.saved.append(draft)
        return len(self.saved)


@dataclass
class StubStore:
    paths: StubPaths


def setup(
    replies: list[str], budget_spent: str | None = None
) -> tuple[
    StubStore,
    InMemoryAi,
    ScriptedLlm,
    AiGateway,
    Callable[[], AbstractContextManager[StubStore]],
]:
    store = StubStore(StubPaths())
    ledger = InMemoryAi(InMemoryStore().users)
    llm = ScriptedLlm(replies)
    gateway = AiGateway(ledger, llm, FakeEmbeddings(), clock=lambda: NOW)
    if budget_spent is not None:
        spend(ledger, None, budget_spent, NOW)

    @contextmanager
    def unit() -> Generator[StubStore]:
        yield store

    return store, ledger, llm, gateway, unit


CANDIDATES = json.dumps(
    {
        "paths": [
            {
                "name": "The web stack",
                "why": "Packets to pages.",
                "concepts": ["tcp", "http", "tls", "cdn"],
            },
            {
                "name": "Names and routes",
                "why": "How hosts are found.",
                "concepts": ["tcp", "dns", "http"],
            },
            {"name": "Unknown", "why": "x", "concepts": ["tcp", "quic", "http"]},
        ]
    }
)


def test_candidates_are_ordered_and_saved_as_drafts() -> None:
    store, ledger, llm, gateway, unit = setup(
        [
            CANDIDATES,
            json.dumps({"sections": [["tcp"], ["http", "tls"], ["cdn"]]}),
            json.dumps({"sections": [["tcp", "dns"], ["http"]]}),
        ]
    )
    got = propose(unit, gateway, "deepseek/x", count=10)
    assert [d.name for d in store.paths.saved] == ["The web stack", "Names and routes"]
    web = store.paths.saved[0]
    assert [(s.concepts, s.moment_ids) for s in web.sections] == [
        (("tcp",), (2, 1)),
        (("http", "tls"), (14, 13, 4, 3)),
        (("cdn",), (15, 5)),
    ]
    assert (got.proposed, got.saved) == (3, 2)
    assert [name for name, _ in got.refused] == ["Unknown"]
    # Every call is recorded under the paths feature (OPS-4).
    assert [u.feature for u in ledger.rows] == ["paths"] * 3
    assert "10" in llm.asked[0][1]["content"]


def test_a_broken_order_is_asked_again_once_then_skipped() -> None:
    bad = json.dumps({"sections": [["http"], ["tcp"], ["tls"], ["cdn"]]})
    store, _, llm, gateway, unit = setup(
        [
            json.dumps({"paths": [json.loads(CANDIDATES)["paths"][0]]}),
            bad,
            bad,
        ]
    )
    got = propose(unit, gateway, "deepseek/x", count=10)
    assert store.paths.saved == []
    assert len(llm.asked) == 3
    assert got.refused == [("The web stack", "tcp comes after http, which needs it")]
    # The retry says why the first order was refused.
    assert "tcp comes after http" in llm.asked[2][-1]["content"]


def test_a_retried_order_that_comes_right_is_saved() -> None:
    store, _, _, gateway, unit = setup(
        [
            json.dumps({"paths": [json.loads(CANDIDATES)["paths"][0]]}),
            "not json",
            json.dumps({"sections": [["tcp"], ["http", "tls"], ["cdn"]]}),
        ]
    )
    assert propose(unit, gateway, "deepseek/x", count=10).saved == 1
    assert len(store.paths.saved) == 1


def test_running_out_of_budget_mid_run_keeps_what_was_saved() -> None:
    store, ledger, llm, gateway, unit = setup(
        [
            CANDIDATES,
            json.dumps({"sections": [["tcp"], ["http", "tls"], ["cdn"]]}),
            json.dumps({"sections": [["tcp", "dns"], ["http"]]}),
        ]
    )
    # The budget runs out once the first path's order is in.
    real = llm.complete

    def complete(model: str, messages: list[Message]) -> Completion:
        got = real(model, messages)
        if len(llm.asked) == 2:
            spend(ledger, None, "5.00", NOW)
        return got

    llm.complete = complete  # type: ignore[method-assign]
    got = propose(unit, gateway, "deepseek/x", count=10)
    assert got.over_budget is True
    assert got.saved == 1 and [d.name for d in store.paths.saved] == ["The web stack"]


def test_over_budget_stops_the_run() -> None:
    store, _, llm, gateway, unit = setup([CANDIDATES], budget_spent="5.00")
    got = propose(unit, gateway, "deepseek/x", count=10)
    assert got.over_budget is True
    assert llm.asked == [] and store.paths.saved == []
