"""Concept tagging and difficulty (AI-2..AI-5, Q-P1-10, P1-W3-S02): one gateway call per
item, answers checked against the concept list, never stored with source text."""

import json
from decimal import Decimal

import pytest

from interval_db.generated import AiProvider
from interval_jobs.adapters.memory import InMemoryAi, InMemoryStore
from interval_jobs.adapters.trafilatura_extractor import extract_sections, extract_text
from interval_jobs.ai.gateway import AiGateway, OverBudget
from interval_jobs.concepts.graph import parse_concepts
from interval_jobs.ports import (
    Completion,
    EmbeddingPurpose,
    Embeddings,
    Message,
    TagInput,
    TagMoment,
    Tags,
)
from interval_jobs.tagging import Tagged, TaggingError, moment_texts, tag_item

TEXT = """Intro paragraph about logs.
Why a log
Writes go to the log first.
Recovery
Replay the log after a crash.
"""
MOMENTS = [
    TagMoment(id=10, ordinal=0, heading=None),
    TagMoment(id=11, ordinal=1, heading="Why a log"),
    TagMoment(id=12, ordinal=2, heading="Recovery"),
]
GRAPH = parse_concepts(
    "version: 1\nconcepts:\n"
    "  - {slug: write-ahead-log, name: WAL, topic: databases}\n"
    "  - {slug: transactions, name: Transactions, topic: databases}\n"
    "  - {slug: replication, name: Replication, topic: distributed-systems}\n",
    "c.yaml",
)


def item(
    full_text: str | None = TEXT,
    excerpt: str | None = None,
    moments: list[TagMoment] | None = None,
) -> TagInput:
    return TagInput(
        title="How our WAL works",
        summary="A tour of the write-ahead log.",
        full_text=full_text,
        excerpt=excerpt,
        moments=(MOMENTS if full_text else []) if moments is None else moments,
        tagged_version=None,
        duplicate=False,
    )


class ScriptedLlm:
    provider: AiProvider = "openrouter"

    def __init__(self, answer: object) -> None:
        self.answer = answer if isinstance(answer, str) else json.dumps(answer)
        self.prompts: list[list[Message]] = []

    def complete(self, model: str, messages: list[Message]) -> Completion:
        self.prompts.append(messages)
        return Completion(self.answer, 900, 120, Decimal("0.002"))


class NoEmbeddings:
    provider: AiProvider = "voyage"

    def embed(
        self, model: str, texts: list[str], purpose: EmbeddingPurpose
    ) -> Embeddings:
        raise AssertionError("tagging never embeds")


def gateway(llm: ScriptedLlm) -> AiGateway:
    return AiGateway(InMemoryAi(InMemoryStore().users), llm, NoEmbeddings())


def answer(*ordinals: int) -> dict[str, object]:
    return {
        "item": {"difficulty": "intermediate", "concepts": ["write-ahead-log"]},
        "moments": [
            {"ordinal": o, "difficulty": "beginner", "concepts": ["transactions"]}
            for o in ordinals
        ],
    }


def tagged(result: Tagged | OverBudget) -> Tagged:
    assert isinstance(result, Tagged)
    return result


def test_each_moment_gets_the_text_under_its_heading() -> None:
    texts = moment_texts(TEXT, MOMENTS)
    assert texts == {
        10: "Intro paragraph about logs.",
        11: "Writes go to the log first.",
        12: "Replay the log after a crash.",
    }


def test_headings_with_permalink_glyphs_are_found_in_real_extractor_output() -> None:
    page = b"""<html><body><article><h1>T</h1><p>Intro text here.</p>
<h2 id="a">Why a log <a href="#a">\xc2\xb6</a></h2><p>Writes go first.</p>
<h2 id="b">Recovery <a href="#b">\xc2\xb6</a></h2><p>Replay after a crash.</p>
</article></body></html>"""
    sections = extract_sections(page, "utf-8", "T")
    moments = [TagMoment(10, 0, None)] + [
        TagMoment(11 + i, i + 1, s.heading) for i, s in enumerate(sections[1:])
    ]
    texts = moment_texts(extract_text(page, "utf-8"), moments)
    assert texts[11] == "Writes go first."
    assert texts[12] == "Replay after a crash."


def test_a_moment_whose_heading_is_missing_is_not_sent(
    capsys: pytest.CaptureFixture[str],
) -> None:
    lost = [*MOMENTS, TagMoment(13, 3, "Not in the text")]
    llm = ScriptedLlm(answer(0, 1, 2))
    result = tagged(tag_item(gateway(llm), "m", item(moments=lost), GRAPH))
    assert 13 not in result.result.moments
    assert "ordinal=3" not in llm.prompts[0][-1]["content"]
    assert "tagging: moment heading not in the text" in capsys.readouterr().out


def test_the_item_and_each_moment_get_difficulty_and_concepts() -> None:
    llm = ScriptedLlm(answer(0, 1, 2))
    result = tagged(tag_item(gateway(llm), "small-model", item(), GRAPH))
    assert result.result.item == Tags("intermediate", frozenset({"write-ahead-log"}))
    assert result.result.moments[11] == Tags("beginner", frozenset({"transactions"}))
    assert result.cost_usd == Decimal("0.002")
    prompt = llm.prompts[0][-1]["content"]
    assert "write-ahead-log" in prompt and "Replay the log after a crash." in prompt


def test_concepts_outside_the_list_are_dropped(
    capsys: pytest.CaptureFixture[str],
) -> None:
    reply = answer(0, 1, 2)
    reply["item"] = {"difficulty": "beginner", "concepts": ["write-ahead-log", "x"]}
    result = tagged(tag_item(gateway(ScriptedLlm(reply)), "m", item(), GRAPH))
    assert result.result.item.concepts == frozenset({"write-ahead-log"})
    assert "tagging: unknown concept dropped" in capsys.readouterr().out


def test_an_item_without_body_text_is_tagged_from_title_summary_and_excerpt() -> None:
    llm = ScriptedLlm(answer())
    result = tagged(
        tag_item(gateway(llm), "m", item(None, excerpt="Logs first."), GRAPH)
    )
    assert result.result.moments == {}
    prompt = llm.prompts[0][-1]["content"]
    assert "A tour of the write-ahead log." in prompt and "Logs first." in prompt


@pytest.mark.parametrize(
    "reply",
    [
        "not json at all",
        {"item": {"difficulty": "expert", "concepts": []}, "moments": []},
        {"moments": []},
        answer(0, 1),  # skipped moment 2
        {**answer(0, 1, 2), "moments": [{"ordinal": True, "difficulty": "beginner"}]},
    ],
)
def test_an_unusable_answer_is_an_error_so_the_stage_retries(reply: object) -> None:
    with pytest.raises(TaggingError):
        tag_item(gateway(ScriptedLlm(reply)), "m", item(), GRAPH)


def test_at_most_five_concepts_are_kept_per_tag() -> None:
    many = [f"c{i}" for i in range(8)]
    graph = parse_concepts(
        "version: 1\nconcepts:\n"
        + "".join(f"  - {{slug: {c}, name: {c}, topic: backend}}\n" for c in many),
        "c.yaml",
    )
    reply: dict[str, object] = {
        "item": {"difficulty": "beginner", "concepts": many},
        "moments": [],
    }
    result = tagged(tag_item(gateway(ScriptedLlm(reply)), "m", item(None), graph))
    assert len(result.result.item.concepts) == 5


def test_no_concept_graph_means_no_call() -> None:
    llm = ScriptedLlm(answer())
    with pytest.raises(TaggingError, match="graph"):
        tag_item(gateway(llm), "m", item(None), None)
    assert llm.prompts == []
