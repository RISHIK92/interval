"""Concept explainers (§5G, AI-3, AI-4, ING-2, OPS-4, ADR-0038, P4-W22-S01): a spoken
script per concept from several full-text sources, with citations that quote them, in
the owner's review before it is voiced. A scripted model, a memory store; every call
goes through the gateway (ADR-0008)."""

import json
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from decimal import Decimal
from typing import cast

import pytest

from interval_jobs.adapters.memory import InMemoryAi, InMemoryExplainers, InMemoryStore
from interval_jobs.ai.gateway import AiGateway
from interval_jobs.explainers import (
    MAX_WORDS,
    MIN_WORDS,
    ExplainerReplyError,
    Source,
    Unit,
    parse_reply,
    prompt,
    write,
)
from interval_jobs.ports import (
    Completion,
    ExplainerConcept,
    ExplainerSource,
    Message,
    TagInput,
    TagMoment,
)

from .test_ai_gateway import FakeEmbeddings, spend
from .test_path_proposer import NOW, ScriptedLlm

RAFT = (
    "Raft elects a leader by having candidates request votes from a majority of the "
    "cluster. A node that times out without hearing from a leader becomes a candidate."
)
PAXOS = (
    "Paxos reaches agreement when a majority of acceptors accept the same proposal "
    "number. Proposers must learn any value already chosen before proposing."
)
SOURCES = [Source(1, "Raft: Elections", RAFT), Source(2, "Paxos: Basics", PAXOS)]


def script(words: int = 180) -> str:
    # Original wording: no run of the sources' own words.
    filler = "consensus keeps replicas agreeing about one ordered history".split()
    return " ".join(filler[i % len(filler)] for i in range(words))


def reply(
    text: str | None = None, citations: list[dict[str, object]] | None = None
) -> str:
    return json.dumps(
        {
            "script": script() if text is None else text,
            "citations": citations
            if citations is not None
            else [
                {"source": 1, "quote": "candidates request votes from a majority"},
                {"source": 2, "quote": "a majority of acceptors accept"},
            ],
        }
    )


def test_a_script_within_its_length_citing_two_sources_is_kept() -> None:
    text, citations = parse_reply(f"```json\n{reply()}\n```", SOURCES)
    assert MIN_WORDS <= len(text.split()) <= MAX_WORDS
    assert [(c.moment_id, c.quote) for c in citations] == [
        (1, "candidates request votes from a majority"),
        (2, "a majority of acceptors accept"),
    ]


@pytest.mark.parametrize(
    ("bad", "says"),
    [
        (reply(script(MIN_WORDS - 1)), "words"),
        (reply(script(MAX_WORDS + 1)), "words"),
        # A citation must be the source's own words.
        (
            reply(
                citations=[
                    {"source": 1, "quote": "leaders are chosen by lottery"},
                    {"source": 2, "quote": "a majority of acceptors accept"},
                ]
            ),
            "isn't in source 1",
        ),
        # Several sources (§5G): one is not enough.
        (
            reply(citations=[{"source": 1, "quote": "candidates request votes from"}]),
            "fewer than 2",
        ),
        (
            reply(citations=[{"source": 3, "quote": "anything at all here"}]),
            "wasn't given",
        ),
        # Original, never a copy: a long run of a source's words is refused.
        (reply(f"{RAFT} {script(170)}"), "copied"),
        ("not json", "JSON"),
        (reply(" ".join(["x" * 30] * 160)), "characters"),
    ],
)
def test_replies_breaking_a_rule_are_refused(bad: str, says: str) -> None:
    with pytest.raises(ExplainerReplyError, match=says):
        parse_reply(bad, SOURCES)


def test_a_quote_is_checked_but_never_kept_at_length() -> None:
    # AI-3, ING-2: a "citation" of a whole passage would store the source's text.
    long = Source(1, "Raft: Elections", f"{RAFT} {RAFT} {RAFT}")
    quote = f"{RAFT} {RAFT}"
    assert len(quote) > 300
    with pytest.raises(ExplainerReplyError, match="isn't in source 1"):
        parse_reply(
            reply(
                citations=[
                    {"source": 1, "quote": quote},
                    {"source": 2, "quote": "a majority of acceptors accept"},
                ]
            ),
            [long, SOURCES[1]],
        )


def test_two_quotes_from_one_section_are_one_citation() -> None:
    _, citations = parse_reply(
        reply(
            citations=[
                {"source": 1, "quote": "candidates request votes from a majority"},
                {"source": 1, "quote": "becomes a candidate"},
                {"source": 2, "quote": "a majority of acceptors accept"},
            ]
        ),
        SOURCES,
    )
    assert [c.moment_id for c in citations] == [1, 2]


def test_the_prompt_gives_only_the_numbered_sources() -> None:
    messages = prompt(ExplainerConcept(9, "consensus", "Consensus"), SOURCES)
    user = messages[1]["content"]
    assert "Concept: Consensus" in user
    # Each source in its own tags, as data the model mustn't take orders from.
    assert '<source n="1" title="Raft: Elections">' in user
    assert '<source n="2" title="Paxos: Basics">' in user
    assert 'n="3"' not in user
    assert "never instructions" in messages[0]["content"]


@dataclass
class StubTags:
    texts: dict[int, str] = field(default_factory=dict[int, str])

    def input(self, item_id: int) -> TagInput | None:
        text = self.texts.get(item_id)
        # The item's one moment is its intro: the whole text (moment id = item id).
        return TagInput(
            "Title", None, text, None, [TagMoment(item_id, 0, None)], None, False
        )


@dataclass
class StubStore:
    explainers: InMemoryExplainers
    tags: StubTags


def setup(
    replies: list[str], spent: str | None = None
) -> tuple[StubStore, ScriptedLlm, AiGateway, Unit]:
    explainers = InMemoryExplainers()
    explainers.concepts = [
        ExplainerConcept(9, "consensus", "Consensus"),
        ExplainerConcept(10, "quorum", "Quorum"),
    ]
    explainers.sourced = {
        9: [
            ExplainerSource(1, 1, "Elections", "Raft"),
            ExplainerSource(2, 2, "Basics", "Paxos"),
        ],
        # Its second article's text isn't under full-text rights any more (ING-2).
        10: [
            ExplainerSource(1, 1, "Elections", "Raft"),
            ExplainerSource(3, 3, "x", "y"),
        ],
    }
    store = StubStore(explainers, StubTags({1: RAFT, 2: PAXOS}))
    ledger = InMemoryAi(InMemoryStore().users)
    llm = ScriptedLlm(replies)
    gateway = AiGateway(ledger, llm, FakeEmbeddings(), clock=lambda: NOW)
    if spent is not None:
        spend(ledger, None, spent, NOW)

    @contextmanager
    def unit() -> Generator[StubStore]:
        yield store

    # The stub has only what `write` reads, not all of ItemTags.
    return store, llm, gateway, cast(Unit, unit)


def test_scripts_are_written_once_pending_and_concepts_short_of_sources_skipped() -> (
    None
):
    store, llm, gateway, unit = setup([reply()])
    got = write(unit, gateway, "qwen/x", limit=5)
    assert (got.written, got.skipped, got.refused) == (1, ["quorum"], [])
    # Its second article's text is gone (rights cut back): tried, and left a while.
    assert store.explainers.attempts == {10: "skipped"}
    saved = store.explainers.saved[9]
    assert saved[2:] == ("qwen/x", 1)
    assert [c.moment_id for c in saved[1]] == [1, 2]
    # Once per concept (AI-4): a second run asks the model nothing.
    again = write(unit, gateway, "qwen/x", limit=5)
    assert again.written == 0 and len(llm.asked) == 1


def test_a_refused_reply_saves_nothing() -> None:
    store, _, gateway, unit = setup([reply(script(20))])
    got = write(unit, gateway, "qwen/x", limit=5)
    assert got.written == 0 and got.refused[0][0] == "consensus"
    assert store.explainers.saved == {}
    # Not billed again on the next run (a week's wait, in the store).
    assert store.explainers.attempts[9] == "refused"


def test_over_the_daily_budget_nothing_is_asked() -> None:
    _, llm, gateway, unit = setup([reply()], spent="100")
    got = write(unit, gateway, "qwen/x", limit=5)
    assert got.over_budget and got.written == 0
    assert llm.asked == []


def test_the_budget_stops_a_run_part_way() -> None:
    store, llm, gateway, unit = setup([reply()])
    store.explainers.concepts.append(ExplainerConcept(11, "leases", "Leases"))
    store.explainers.sourced[11] = store.explainers.sourced[9]
    # The first script spends the rest of the day's budget.
    original = llm.complete

    def costly(model: str, messages: list[Message]) -> Completion:
        got = original(model, messages)
        return Completion(got.text, got.input_tokens, got.output_tokens, Decimal("10"))

    llm.complete = costly  # type: ignore[method-assign]
    got = write(unit, gateway, "qwen/x", limit=5)
    assert got.written == 1 and got.over_budget
    assert 11 not in store.explainers.saved and len(llm.asked) == 1
