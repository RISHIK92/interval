"""The path proposer (§5F, Q-P2-24, Q-P2-25, P2-W10-S01): the model proposes candidate
topic paths from the concepts there is something to read on, then orders each into
sections by prerequisites; sessions are picked by rule and each path is saved as a
draft for the owner to review (P2-W10-S02). Every call goes through the gateway
(ADR-0008): budgeted, price-capped, recorded under `paths` (OPS-4).

Reads and writes happen in short units; the model calls happen between them."""

from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass, field
from typing import Protocol

from interval_jobs import log
from interval_jobs.ai.gateway import AiGateway, OverBudget
from interval_jobs.paths import (
    PROMPT_VERSION,
    PathReplyError,
    candidates_prompt,
    draft_path,
    order_prompt,
    parse_candidates,
    parse_order,
)
from interval_jobs.ports import Message, Paths

# One more try for an order that breaks a rule; then the candidate is skipped.
ORDER_ATTEMPTS = 2


class HasPaths(Protocol):
    @property
    def paths(self) -> Paths: ...


type Unit = Callable[[], AbstractContextManager[HasPaths]]


@dataclass
class Proposed:
    proposed: int = 0
    saved: int = 0
    refused: list[tuple[str, str]] = field(default_factory=list[tuple[str, str]])
    over_budget: bool = False


class _OverBudget(Exception):
    pass


def _ask(gateway: AiGateway, model: str, messages: list[Message]) -> str:
    got = gateway.complete(
        feature="paths", user_id=None, model=model, messages=messages
    )
    if isinstance(got, OverBudget):
        raise _OverBudget
    return got.text


def propose(unit: Unit, gateway: AiGateway, model: str, count: int) -> Proposed:
    report = Proposed()
    with unit() as store:
        coverage = store.paths.coverage()
        edges = store.paths.prerequisites()
    try:
        try:
            candidates, refused = parse_candidates(
                _ask(gateway, model, candidates_prompt(coverage, edges, count)),
                coverage,
            )
        except PathReplyError as error:
            log.warn("paths: candidates refused", error=str(error))
            report.refused.append(("(all)", str(error)))
            return report
        report.proposed = len(candidates) + len(refused)
        report.refused += refused
        with unit() as store:
            pool = store.paths.session_candidates(
                {slug for c in candidates for slug in c.concepts}
            )
        for candidate in candidates:
            sections: list[tuple[str, ...]] | None = None
            reason = ""
            messages = order_prompt(candidate, edges)
            for _ in range(ORDER_ATTEMPTS):
                try:
                    sections = parse_order(
                        _ask(gateway, model, messages), candidate, edges
                    )
                    break
                except PathReplyError as error:
                    reason = str(error)
                    # The retry says what was wrong, so it isn't the same guess.
                    hint: Message = {
                        "role": "user",
                        "content": f"Your order was refused: {reason}. Try again.",
                    }
                    messages = [*order_prompt(candidate, edges), hint]
            if sections is None:
                log.warn("paths: order refused", path=candidate.name, error=reason)
                report.refused.append((candidate.name, reason))
                continue
            draft = draft_path(candidate, sections, pool)
            if draft is None:
                report.refused.append(
                    (candidate.name, "under 2 sections with 2 readings each")
                )
                continue
            with unit() as store:
                store.paths.save_draft(draft, model, PROMPT_VERSION)
            report.saved += 1
    except _OverBudget:
        # OPS-4, LOAD-5: what was saved stays; the owner runs it again later.
        log.warn("paths: over budget; stopped", saved=report.saved)
        report.over_budget = True
    return report
