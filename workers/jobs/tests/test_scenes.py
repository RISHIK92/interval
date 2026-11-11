"""Drafting scene timelines (TTS-5, AI-1, AI-3, OPS-4, DB-6, P4.5-W26-S01; owner,
Q-P4.5-03): EXPLAINER_MODEL drafts one for each approved, voiced explainer from its
script and captions; the draft is checked against the timeline's generated JSON Schema
(jsonschema, structure only), retried once with the errors, then stored pending in the
media bucket, or recorded as refused. Fakes; no model is called."""

import json
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import cast

from interval_db.generated import AiFeature
from interval_jobs.adapters.memory import (
    InMemoryAi,
    InMemoryFiles,
    InMemoryScenes,
    InMemoryStore,
)
from interval_jobs.ai.gateway import AiGateway, Completed, OverBudget
from interval_jobs.ports import ExplainerToDraw, Message
from interval_jobs.scenes import PROMPT_VERSION, Unit, draw, prompt, schema

from .test_ai_gateway import FakeEmbeddings, spend
from .test_path_proposer import NOW, ScriptedLlm

EXPLAINER = ExplainerToDraw(
    7,
    3,
    "Leader election",
    "Raft elects a leader when a node's timer runs out.",
    ["Raft", "elects", "a", "leader", "when", "a", "node's", "timer", "runs", "out."],
)

GOOD = {
    "diagram": {
        "title": "Leader election",
        "shapes": [
            {
                "id": "a",
                "kind": "service",
                "label": "Node A",
                "at": {"col": 0, "row": 0},
            },
            {
                "id": "b",
                "kind": "service",
                "label": "Node B",
                "at": {"col": 5, "row": 0},
            },
        ],
        "arrows": [{"from": "a", "to": "b", "label": "vote"}],
    },
    "steps": [
        {"at": 0, "show": ["a", "b"], "describe": "Two nodes."},
        {"at": 3, "show": ["a->b"], "describe": "A asks B for a vote."},
    ],
}
# Structurally wrong: a step with no description.
BAD = {
    **GOOD,
    "steps": [{"at": 0, "show": ["a"]}],
}


@dataclass
class Stub:
    scenes: InMemoryScenes


def setup(
    replies: list[str], spent: str | None = None
) -> tuple[Stub, InMemoryFiles, ScriptedLlm, AiGateway, Unit]:
    store = Stub(InMemoryScenes())
    store.scenes.drawable = [EXPLAINER]
    ledger = InMemoryAi(InMemoryStore().users)
    llm = ScriptedLlm(replies)
    gateway = AiGateway(ledger, llm, FakeEmbeddings(), clock=lambda: NOW)
    if spent is not None:
        spend(ledger, None, spent, NOW)

    @contextmanager
    def unit() -> Generator[Stub]:
        yield store

    return store, InMemoryFiles(), llm, gateway, cast(Unit, unit)


def test_a_valid_draft_is_stored_pending_with_its_json_in_the_media_bucket() -> None:
    store, media, llm, gateway, unit = setup([json.dumps(GOOD)])
    got = draw(unit, gateway, media, "qwen/x", limit=5)
    assert (got.drawn, got.refused, got.over_budget) == (1, [], False)
    ((key, model, version),) = store.scenes.saved.values()
    assert key.startswith("media/explainers/3/7/scenes/") and key.endswith(".json")
    assert (model, version) == ("qwen/x", PROMPT_VERSION)
    assert json.loads(media.stored[key]) == GOOD
    assert media.types[key] == "application/json"
    assert len(llm.asked) == 1
    # Once an explainer: a second run asks nothing.
    assert draw(unit, gateway, media, "qwen/x", limit=5).drawn == 0
    assert len(llm.asked) == 1


def test_a_draft_failing_the_schema_is_retried_once_with_the_errors() -> None:
    store, media, llm, gateway, unit = setup(
        [json.dumps(BAD), "```json\n" + json.dumps(GOOD) + "\n```"]
    )
    got = draw(unit, gateway, media, "qwen/x", limit=5)
    assert got.drawn == 1
    assert len(llm.asked) == 2
    # The retry carries the draft and what was wrong with it.
    retry = llm.asked[1]
    assert retry[-2]["role"] == "assistant"
    assert "$.steps[0]: 'describe' is a required property" in retry[-1]["content"]
    assert len(store.scenes.saved) == 1


def test_wrong_twice_saves_nothing_and_is_left_alone_for_a_while() -> None:
    store, media, llm, gateway, unit = setup(["not json at all", json.dumps(BAD)])
    got = draw(unit, gateway, media, "qwen/x", limit=5)
    assert got.drawn == 0
    assert got.refused == [(7, "$.steps[0]: 'describe' is a required property")]
    assert store.scenes.saved == {} and media.stored == {}
    assert store.scenes.refused == {7}
    assert len(llm.asked) == 2


def test_over_the_budget_nothing_is_asked() -> None:
    store, media, llm, gateway, unit = setup([json.dumps(GOOD)], spent="100")
    got = draw(unit, gateway, media, "qwen/x", limit=5)
    assert got.over_budget and got.drawn == 0
    assert llm.asked == [] and store.scenes.saved == {}


def test_the_prompt_holds_the_schema_and_the_numbered_caption_words() -> None:
    messages = prompt(EXPLAINER)
    system = messages[0]["content"]
    assert json.dumps(schema(), separators=(",", ":")) in system
    user = messages[1]["content"]
    assert "Leader election" in user
    assert EXPLAINER.script in user
    # Everything from the explainer, words included, is inside the tags.
    assert user.startswith("<explainer>") and user.endswith("</explainer>")
    assert "0 Raft\n1 elects\n" in user and "9 out." in user


def test_over_the_budget_at_the_retry_the_explainer_is_tried_again_next_run() -> None:
    store, media, _, real, unit = setup([json.dumps(BAD)])
    calls: list[object] = []

    class Gateway:
        """The real gateway for the first draft; the budget runs out at the retry."""

        def complete(
            self,
            *,
            feature: AiFeature,
            user_id: str | None,
            model: str,
            messages: list[Message],
        ) -> Completed | OverBudget:
            calls.append(messages)
            if len(calls) > 1:
                return OverBudget("global")
            return real.complete(
                feature=feature, user_id=user_id, model=model, messages=messages
            )

    got = draw(unit, cast(AiGateway, Gateway()), media, "qwen/x", limit=5)
    assert len(calls) == 2
    assert got.over_budget and got.drawn == 0 and got.refused == []
    assert store.scenes.refused == set() and media.stored == {}
