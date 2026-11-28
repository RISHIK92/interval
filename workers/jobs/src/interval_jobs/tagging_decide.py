"""Asking a decision model about a text's shortlisted concepts (tagging v3,
2026-10-27): a yes/no question per shortlisted concept, plus one difficulty question,
asked again only when the text changed since this model last saw it. An article is
asked once, about its title, summary and the text its rights allow (its full text,
else its excerpt), cut to TEXT_CHARS (ADR-0058). A book chapter is asked about each
session, and once more about its title. The raw probabilities are returned for
storing; `tagging_rollup` turns them into tags."""

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
from interval_jobs.tagging import TEXT_CHARS, TaggingError, session_texts
from interval_jobs.tagging_shortlist import shortlist

# The candidates asked about per text; at 15 the shortlist kept 99% of the labelled
# concepts on the eval (2026-10-27).
SHORTLIST = 15
_EMBED_BATCH = 32
_RUBRIC = [
    "Beginner: assumes little beyond programming basics",
    "Intermediate: assumes working knowledge of the topic",
    "Advanced: assumes deep familiarity; covers internals, trade-offs or research",
]


# Bump when the questions, rubric or shortlist rules change: every text is asked
# again under the new wording.
DECIDE_VERSION = 2


def content_hash(text: str, graph_version: int, embedding_model: str, size: int) -> str:
    """What a text was asked about: the text, and everything that picks or words its
    questions (the decide version, the concept graph, the shortlist's model and size).
    """
    key = f"{DECIDE_VERSION}|{graph_version}|{embedding_model}|{size}\n{text}"
    return hashlib.sha256(key.encode()).hexdigest()


def article_text(item: TagInput) -> str:
    """What an article is asked about whole (ADR-0058): its title, summary and the
    text its rights allow (its full text, else its excerpt), cut to TEXT_CHARS."""
    body = item.full_text or item.excerpt or ""
    parts = (item.title, item.summary or "", body)
    return "\n".join(p for p in parts if p)[:TEXT_CHARS]


@dataclass(frozen=True)
class Answered:
    content_hash: str
    difficulty: float
    probabilities: dict[str, float]  # concept slug -> probability of "yes"


@dataclass(frozen=True)
class DecidePass:
    sessions: dict[int, Answered]  # a book chapter's sessions, by id
    item: Answered | None  # the title (an article's whole) pass, when it was asked
    cost_usd: Decimal
    # Set when the budget or the model stopped the pass part way: what was answered
    # before is still here, to be kept (the hash skip then resumes from there).
    refused: OverBudget | None = None
    stopped: str | None = None


def _questions(slugs: Sequence[str], graph: ConceptGraph) -> dict[str, object]:
    by_slug = {c.slug: c for c in graph.concepts}
    questions: dict[str, object] = {
        slug: {
            "type": "noul",
            "instructions": (
                f"Would a software engineer learn something about "
                f"{by_slug[slug].name} from this text?"
            ),
            "criteria": {
                "true": f"It explains, applies, compares or works through "
                f"{by_slug[slug].name}"
                + (
                    f": {by_slug[slug].description}"
                    if by_slug[slug].description
                    else ""
                ),
                "false": "It names it only in passing, or not at all.",
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
    known_item: str | None,
    *,
    size: int = SHORTLIST,
    user_id: str | None = None,  # a book's owner pays for its tagging (OPS-4)
) -> DecidePass:
    texts = session_texts(item.full_text, item.sessions) if item.full_text else {}
    # A heading with nothing under it has no text to embed or ask about.
    sent = [
        m
        for m in sorted(item.sessions, key=lambda m: m.ordinal)
        if texts.get(m.id, "").strip()
    ]
    todo: list[tuple[int | None, DecisionState, str, str]] = []  # id, state, text, hash
    for m in sent:
        text = texts[m.id][:TEXT_CHARS]
        digest = content_hash(text, graph.version, embedding_model, size)
        state: DecisionState = {
            "article": item.title,
            "section": m.heading or "Introduction",
            "text": text,
        }
        todo.append((m.id, state, text, digest))
    # Sessions are asked about one by one; an article's text goes in its one pass.
    title = (
        "\n".join(p for p in (item.title, item.summary or "") if p)[:TEXT_CHARS]
        if sent
        else article_text(item)
    )
    title_hash = content_hash(title, graph.version, embedding_model, size)
    if title_hash != known_item:
        todo.append((None, {"article": item.title, "text": title}, title, title_hash))
    if not todo:
        return DecidePass({}, None, Decimal(0))

    cost = Decimal(0)
    vector_of: dict[int | None, Sequence[float]] = {}
    for start in range(0, len(todo), _EMBED_BATCH):
        batch = todo[start : start + _EMBED_BATCH]
        result = gateway.embed(
            feature="tagging",
            user_id=user_id,
            model=embedding_model,
            texts=[text for _, _, text, _ in batch],
            purpose="document",
        )
        if isinstance(result, OverBudget):
            return DecidePass({}, None, cost, refused=result)
        cost += result.usage.cost_usd
        for (session_id, _, _, _), vector in zip(batch, result.vectors, strict=True):
            vector_of[session_id] = vector

    sessions: dict[int, Answered] = {}
    title_answer: Answered | None = None
    for session_id, state, text, digest in todo:
        vector = vector_of[session_id]
        candidates = shortlist(
            vector, None, text, vectors, graph, size=size, prior_size=0
        )
        try:
            decided = gateway.decide(
                feature="tagging",
                user_id=user_id,
                model=model,
                state=state,
                questions=_questions(candidates, graph),
            )
            if isinstance(decided, OverBudget):
                return DecidePass(sessions, title_answer, cost, refused=decided)
            cost += decided.usage.cost_usd
            answered = Answered(digest, *_read(decided.answers, candidates))
        except (ModelError, TaggingError) as error:
            return DecidePass(sessions, title_answer, cost, stopped=str(error))
        if session_id is None:
            title_answer = answered
        else:
            sessions[session_id] = answered
    return DecidePass(sessions, title_answer, cost)


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
