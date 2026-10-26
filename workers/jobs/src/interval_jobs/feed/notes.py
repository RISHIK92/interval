"""Why-this-matters notes (§5E, REC-5, Q-P1-18, P1-W4-S06): a template per top ranking
signal, worded by the owner (2026-10-26), then polished once by the notes model when one
is set (AI-2, AI-4). Built only from the source's name and the user's choices, and the
model sees only the article's title besides (AI-1): a note never restates the article.
"""

from datetime import datetime, timedelta

from interval_db.generated import BreakLength, Difficulty, LearningGoal, Topic
from interval_jobs import log
from interval_jobs.ai.gateway import AiGateway, OverBudget
from interval_jobs.ports import JobQueue, Message, NoteInput, NoteKey
from interval_jobs.ranking.scoring import BREAK_MINUTES, Scored

NOTE_MAX_CHARS = 160  # a card line, not a summary

_SYSTEM = (
    "You rewrite a short note that tells a reader why an article was picked for "
    "them. Keep its meaning and every fact in it; add nothing about the article "
    "beyond its title. Reply with one plain sentence of at most 160 characters."
)


def _words(slug: str) -> str:
    return slug.replace("-", " ")


TRUSTED_QUALITY = 4  # "one of the most trusted sources here": rated 4 or 5 (ING-6)
FRESH = timedelta(days=7)  # "New this week."


# How a goal reads in a note (ADR-0015, owner 2026-10-26); only goals that point at
# concepts can be a card's reason.
GOAL_WORDS: dict[LearningGoal, str] = {
    "system-design-interviews": "pass system design interviews",
}

type GoalSets = tuple[tuple[LearningGoal, frozenset[str]], ...]


def _note(
    signal: str,
    scored: Scored,
    topics: list[Topic],
    level: Difficulty,
    chip: BreakLength,
    now: datetime,
    goals: GoalSets,
) -> tuple[NoteKey, str] | None:
    """The signal's note, or None when its words wouldn't be true of this entry."""
    facts, item = scored.facts, scored.item_id
    if signal == "goal_match":
        goal: LearningGoal | None = next(
            (
                g
                for g, concepts in goals
                if facts.concepts & concepts and g in GOAL_WORDS
            ),
            None,
        )
        if goal is None:
            return None
        return (
            NoteKey(item, signal, level, goal),
            f"Toward your goal: {GOAL_WORDS[goal]}.",
        )
    if signal == "topic_match":
        topic = next((t for t in topics if t in facts.topics), None)
        if topic is None:
            return None
        return (
            NoteKey(item, signal, level, topic),
            f"On {_words(topic)}, a topic you chose.",
        )
    if signal == "level_fit":
        if facts.difficulty != level:
            return None
        return NoteKey(item, signal, level, ""), f"Pitched at your {level} level."
    if signal == "quality":
        if facts.quality is None or facts.quality < TRUSTED_QUALITY:
            return None
        return (
            NoteKey(item, signal, level, ""),
            f"From {facts.source_name}, one of the most trusted sources here.",
        )
    if signal == "freshness":
        if facts.published_at is None or now - facts.published_at > FRESH:
            return None
        return NoteKey(item, signal, level, ""), "New this week."
    if signal == "time_fit":
        if facts.minutes is None or facts.minutes > BREAK_MINUTES[chip][1]:
            return None
        return (
            NoteKey(item, signal, level, chip),
            # An en dash, as the web's chip labels show it.
            f"Sized for your {chip.replace('-', '\u2013')} min break.",
        )
    raise ValueError(f"no note for signal {signal!r}")


def note_for(
    scored: Scored,
    topics: list[Topic],
    level: Difficulty,
    chip: BreakLength,
    now: datetime,
    goals: GoalSets = (),
) -> tuple[NoteKey, str] | None:
    """The cache key and template text for the entry's largest signal whose note is
    true of it (owner, 2026-10-26); None when no note would be."""
    for signal in scored.signals:
        found = _note(signal, scored, topics, level, chip, now, goals)
        if found is not None:
            return found
    return None


def queue_polish(queue: JobQueue, note_ids: set[int]) -> None:
    """One polish job per note; the key makes a repeat while queued a no-op."""
    for note_id in sorted(note_ids):
        queue.enqueue(
            "polish_note", {"note_id": note_id}, idempotency_key=f"polish-{note_id}"
        )


def polish_note(
    gateway: AiGateway, model: str, note: NoteInput
) -> str | OverBudget | None:
    """The model's wording, or None when its reply isn't one short sentence (the
    template stays)."""
    messages: list[Message] = [
        {"role": "system", "content": _SYSTEM},
        {
            "role": "user",
            "content": (
                f"Title: {note.title}\nSource: {note.source_name}\nNote: {note.text}"
            ),
        },
    ]
    result = gateway.complete(
        feature="notes", user_id=None, model=model, messages=messages
    )
    if isinstance(result, OverBudget):
        return result
    text = result.text.strip()
    if not text or "\n" in text or len(text) > NOTE_MAX_CHARS:
        log.warn("notes: reply refused; the template stays", note_id=note.note_id)
        return None
    return text
