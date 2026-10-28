"""A book chapter's checkpoint, made when the user reaches the chapter's end (§5F,
Q-P2-35, P2-W11-S06), so unread chapters cost nothing.

The chapter's sessions go through the same steps as a moment: the W3 decision tagger
(owner, 2026-10-29), then the W8 generator and its blind validator (Q-1). Every call is
on the book owner's budget (OPS-4) and goes through the gateway (ADR-0008). Its text
goes to the questions model as-is (Q-P2-38, owner 2026-10-29: no retention flag)."""

from collections.abc import Callable, Generator
from contextlib import AbstractContextManager
from dataclasses import dataclass

from interval_db.generated import Difficulty
from interval_jobs import log
from interval_jobs.ai.gateway import AiGateway, OverBudget
from interval_jobs.ports import (
    BookQuestion,
    ChapterForCheckpoint,
    ConceptGraph,
    ItemDecisions,
    ModelError,
    Store,
    TagInput,
    TagMoment,
)
from interval_jobs.questions import (
    QuestionReplyError,
    content_hash,
    parse_answer,
    parse_reply,
    prompt,
    shuffled,
    validation_prompt,
)
from interval_jobs.tagging import MOMENT_CHARS
from interval_jobs.tagging_decide import decide
from interval_jobs.tagging_rollup import rollup

# A checkpoint asks 5; two drafts from each of 6 sessions leave room for rejections
# and keep a long chapter's cost bounded.
MAX_SESSIONS = 6
NO_QUESTIONS = "Couldn't make questions for this chapter."
OVER_BUDGET = "Today's AI budget is used up. Try again tomorrow."
GAVE_UP = "Couldn't make questions for this chapter right now. Try again later."
NOT_CONFIGURED = "Checkpoints aren't available right now."

type Stores = Callable[[], AbstractContextManager[Store]]


@dataclass(frozen=True)
class CheckpointModels:
    tagger: str  # the decision model, without its "decisions:" prefix
    embedding: str  # for the tagger's shortlist
    questions: str  # drafting and validating, one call each
    gateway: Callable[[], AbstractContextManager[AiGateway]]


class OverBudgetError(Exception):
    """The owner's daily AI budget is spent: the checkpoint fails with that reason."""


def spread(count: int, most: int) -> list[int]:
    """Up to `most` indexes from 0..count-1, evenly through them, first and last in."""
    if count <= most:
        return list(range(count))
    return sorted({round(i * (count - 1) / (most - 1)) for i in range(most)})


def _as_item(chapter: ChapterForCheckpoint, picked: list[int]) -> TagInput:
    """The chapter as an article for the tagger: each picked session a moment under a
    heading of its own, so moment_texts finds each one's text."""
    lines: list[str] = []
    moments: list[TagMoment] = []
    for ordinal, index in enumerate(picked):
        heading = f"Session {index + 1} of {len(chapter.sessions)}"
        lines += [heading, chapter.sessions[index][1]]
        moments.append(TagMoment(index, ordinal, heading))
    return TagInput(
        title=chapter.title,
        summary=chapter.book_title,
        full_text="\n".join(lines),
        excerpt=None,
        moments=moments,
        tagged_version=None,
        duplicate=False,
    )


def make_checkpoint(stores: Stores, models: CheckpointModels, chapter_id: int) -> None:
    """Reads, calls the models with no transaction open, then saves. A model error
    raises for the queue to retry; an empty or over-budget result fails the
    checkpoint with its reason."""
    with stores() as store:
        chapter = store.books.checkpoint_input(chapter_id)
        graph = store.concepts.state()
        stored = store.concepts.vectors(models.embedding)
    if chapter is None:
        log.info("books: checkpoint not wanted now", chapter_id=chapter_id)
        return
    if graph is None:
        raise ModelError("no concept graph loaded")
    try:
        concepts, questions = _ask(chapter, models, graph, stored)
    except OverBudgetError:
        log.warn("books: checkpoint over budget", chapter_id=chapter_id)
        with stores() as store:
            store.books.fail_checkpoint(chapter_id, OVER_BUDGET)
        return
    with stores() as store:
        saved = store.books.save_checkpoint(
            chapter_id, concepts, questions, models.questions, models.questions
        )
        if saved == "empty":
            store.books.fail_checkpoint(chapter_id, NO_QUESTIONS)
    if saved == "gone":
        # A second run (a request asked again while the first still ran): its
        # questions are dropped; the first's stand.
        log.info("books: checkpoint no longer wanted; dropped", chapter_id=chapter_id)
        return
    log.info(
        "books: checkpoint made",
        chapter_id=chapter_id,
        live=sum(q.live for q in questions),
        drafted=len(questions),
    )


def _ask(
    chapter: ChapterForCheckpoint,
    models: CheckpointModels,
    graph: ConceptGraph,
    stored: dict[str, tuple[str, list[float]]],
) -> tuple[frozenset[str], list[BookQuestion]]:
    active = {c.slug for c in graph.concepts if not c.retired}
    names = {c.slug: c.name for c in graph.concepts}
    picked = [
        i for i in spread(len(chapter.sessions), MAX_SESSIONS) if chapter.sessions[i][1]
    ]
    with models.gateway() as gateway:
        asked = decide(
            gateway,
            models.tagger,
            models.embedding,
            _as_item(chapter, picked),
            graph,
            {slug: v for slug, (_, v) in stored.items() if slug in active},
            {},
            None,
            user_id=chapter.user_id,
        )
        if asked.refused is not None:
            raise OverBudgetError
        if asked.stopped is not None:
            raise ModelError(asked.stopped)
        tags = rollup(
            ItemDecisions(
                {m: (a.difficulty, a.probabilities) for m, a in asked.moments.items()},
                {} if asked.item is None else asked.item.probabilities,
                None if asked.item is None else asked.item.difficulty,
            ),
            active,
        )
        questions: list[BookQuestion] = []
        for index in picked:
            session = tags.moments.get(index)
            # A session the tagger found nothing in is asked about the chapter's; a
            # chapter with none at all still gets questions, and a pass then marks
            # nothing practiced (its misses have no concept to review either).
            slugs = (
                session.concepts if session and session.concepts else tags.item.concepts
            )
            text = chapter.sessions[index][1][:MOMENT_CHARS]
            questions += _questions_of(
                gateway,
                models.questions,
                chapter.user_id,
                text,
                slugs,
                [names[s] for s in sorted(slugs)],
                session.difficulty if session else tags.item.difficulty,
            )
    return tags.item.concepts, questions


def _questions_of(
    gateway: AiGateway,
    model: str,
    user_id: str,
    text: str,
    slugs: frozenset[str],
    names: list[str],
    difficulty: Difficulty | None,
) -> Generator[BookQuestion]:
    drafted = gateway.complete(
        feature="questions",
        user_id=user_id,
        model=model,
        messages=prompt(text, names),
    )
    if isinstance(drafted, OverBudget):
        raise OverBudgetError
    try:
        drafts = parse_reply(drafted.text, text)
    except QuestionReplyError as error:
        # One session's broken reply leaves the others' questions.
        log.warn("books: a session's drafts were unreadable", error=str(error))
        return
    for draft in (shuffled(d) for d in drafts):
        answered = gateway.complete(
            feature="questions",
            user_id=user_id,
            model=model,
            messages=validation_prompt(text, draft),
        )
        if isinstance(answered, OverBudget):
            raise OverBudgetError
        try:
            answer: int | None = parse_answer(answered.text)
        except QuestionReplyError:
            answer = None  # unreadable: rejected, as a disagreement would be
        yield BookQuestion(
            draft,
            slugs,
            answer,
            difficulty,
            content_hash(text, sorted(slugs)),
        )
