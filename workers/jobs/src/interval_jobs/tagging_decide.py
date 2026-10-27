"""Asking a decision model about each moment's shortlisted concepts (tagging v3,
2026-10-27). One call per moment whose content changed since this model last saw it:
a yes/no question per shortlisted concept, plus one difficulty question. One more call
for the article's title and summary (its excerpt when it has no moments). The raw
probabilities are returned for storing; `tagging_rollup` turns them into tags."""

import hashlib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal

from interval_jobs.ai.gateway import AiGateway, OverBudget
from interval_jobs.ports import (
    ConceptGraph,
    DecisionAnswer,
    DecisionState,
    ModelError,
    NoulAnswer,
    ScoreAnswer,
    TagInput,
)
from interval_jobs.tagging import MOMENT_CHARS, TaggingError, moment_texts
from interval_jobs.tagging_shortlist import shortlist

# The candidates asked about per moment; at 15 the shortlist kept 99% of the labelled
# concepts on the eval (2026-10-27).
SHORTLIST = 15
_EMBED_BATCH = 32
_RUBRIC = [
    "Beginner: assumes little beyond programming basics",
    "Intermediate: assumes working knowledge of the topic",
    "Advanced: assumes deep familiarity; covers internals, trade-offs or research",
]


# Bump when the questions, rubric or shortlist rules change: every moment is asked
# again under the new wording.
DECIDE_VERSION = 1


def content_hash(text: str, graph_version: int, embedding_model: str, size: int) -> str:
    """What a moment was asked about: its text, and everything that picks or words its
    questions (the decide version, the concept graph, the shortlist's model and size).
    """
    key = f"{DECIDE_VERSION}|{graph_version}|{embedding_model}|{size}\n{text}"
    return hashlib.sha256(key.encode()).hexdigest()


@dataclass(frozen=True)
class Answered:
    content_hash: str
    difficulty: float
    probabilities: dict[str, float]  # concept slug -> probability of "yes"


@dataclass(frozen=True)
class DecidePass:
    moments: dict[int, Answered]  # only the moments asked this time
    item: Answered | None  # the title pass, when it was asked
    cost_usd: Decimal
    # The item's moments with text now, asked or unchanged: answers for any other
    # moment are stale and are left out of the roll-up.
    current: frozenset[int] = frozenset()
    # Set when the budget or the model stopped the pass part way: what was answered
    # before is still here, to be kept (the hash skip then resumes from there).
    refused: OverBudget | None = None
    stopped: str | None = None


def _questions(slugs: Sequence[str], graph: ConceptGraph) -> dict[str, object]:
    by_slug = {c.slug: c for c in graph.concepts}
    questions: dict[str, object] = {
        slug: {
            "type": "noul",
            "instructions": f"Does this text substantively teach {by_slug[slug].name}?",
            "criteria": {
                "true": f"It explains {by_slug[slug].name}"
                + (
                    f": {by_slug[slug].description}"
                    if by_slug[slug].description
                    else ""
                ),
                "false": "It only mentions it in passing, or not at all.",
            },
        }
        for slug in slugs
    }
    questions["difficulty"] = {
        "type": "score",
        "instructions": "How advanced is this text for a software engineer?",
        "criteria": _RUBRIC,
    }
    return questions


def decide(
    gateway: AiGateway,
    model: str,
    embedding_model: str,
    item: TagInput,
    graph: ConceptGraph,
    vectors: Mapping[str, Sequence[float]],
    known: Mapping[int, str],
    known_item: str | None,
    *,
    size: int = SHORTLIST,
    embedded: Mapping[int, Sequence[float]] | None = None,
) -> DecidePass:
    texts = moment_texts(item.full_text, item.moments) if item.full_text else {}
    # A heading with nothing under it has no text to embed or ask about.
    sent = [
        m
        for m in sorted(item.moments, key=lambda m: m.ordinal)
        if texts.get(m.id, "").strip()
    ]
    todo: list[tuple[int | None, DecisionState, str, str]] = []  # id, state, text, hash
    for m in sent:
        text = texts[m.id][:MOMENT_CHARS]
        digest = content_hash(text, graph.version, embedding_model, size)
        if known.get(m.id) != digest:
            state: DecisionState = {
                "article": item.title,
                "section": m.heading or "Introduction",
                "text": text,
            }
            todo.append((m.id, state, text, digest))
    title = "\n".join(
        part
        for part in (item.title, item.summary or "", "" if sent else item.excerpt or "")
        if part
    )[:MOMENT_CHARS]
    title_hash = content_hash(title, graph.version, embedding_model, size)
    if title_hash != known_item:
        todo.append((None, {"article": item.title, "text": title}, title, title_hash))
    current = frozenset(m.id for m in sent)
    if not todo:
        return DecidePass({}, None, Decimal(0), current)

    cost = Decimal(0)
    # A vector the embed stage stored for a moment is reused when it embedded the same
    # text: that stage cuts at 16000 characters, this one at MOMENT_CHARS.
    vector_of: dict[int | None, Sequence[float]] = {
        moment_id: vector
        for moment_id, vector in (embedded or {}).items()
        if len(texts.get(moment_id, "")) <= MOMENT_CHARS
    }
    unembedded = [entry for entry in todo if entry[0] not in vector_of]
    for start in range(0, len(unembedded), _EMBED_BATCH):
        batch = unembedded[start : start + _EMBED_BATCH]
        result = gateway.embed(
            feature="tagging",
            user_id=None,
            model=embedding_model,
            texts=[text for _, _, text, _ in batch],
            purpose="document",
        )
        if isinstance(result, OverBudget):
            return DecidePass({}, None, cost, current, refused=result)
        cost += result.usage.cost_usd
        for (moment_id, _, _, _), vector in zip(batch, result.vectors, strict=True):
            vector_of[moment_id] = vector

    moments: dict[int, Answered] = {}
    title_answer: Answered | None = None
    for moment_id, state, text, digest in todo:
        vector = vector_of[moment_id]
        candidates = shortlist(
            vector, None, text, vectors, graph, size=size, prior_size=0
        )
        try:
            decided = gateway.decide(
                feature="tagging",
                user_id=None,
                model=model,
                state=state,
                questions=_questions(candidates, graph),
            )
            if isinstance(decided, OverBudget):
                return DecidePass(moments, title_answer, cost, current, refused=decided)
            cost += decided.usage.cost_usd
            answered = Answered(digest, *_read(decided.answers, candidates))
        except (ModelError, TaggingError) as error:
            return DecidePass(moments, title_answer, cost, current, stopped=str(error))
        if moment_id is None:
            title_answer = answered
        else:
            moments[moment_id] = answered
    return DecidePass(moments, title_answer, cost, current)


def _read(
    answers: Mapping[str, DecisionAnswer], candidates: Sequence[str]
) -> tuple[float, dict[str, float]]:
    level = answers.get("difficulty")
    if not isinstance(level, ScoreAnswer):
        raise TaggingError("the decision is missing its difficulty")
    probabilities: dict[str, float] = {}
    for slug in candidates:
        answer = answers.get(slug)
        if not isinstance(answer, NoulAnswer):
            raise TaggingError(f"the decision is missing its answer for {slug}")
        probabilities[slug] = answer.probability
    return level.score, probabilities
