"""Card explanations from a template library (ADR-0025, Q-P2-45): at most one per card,
filled only from stored data (the item's tags and source, the concept graph, the user's
choices and projects), never from a model. The card's top ranking reason picks the
category; a stable hash of the item picks the template, so wording holds across
refreshes. Every reason stays on the feed entry (top signal, breakdown) either way.
"""

import hashlib
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import cache
from pathlib import Path
from typing import Literal, cast, get_args

import yaml

from interval_db.generated import Difficulty, LearningGoal, Topic
from interval_jobs import log
from interval_jobs.ports import ConceptGraph, NoteKey, ProjectConcepts
from interval_jobs.ranking.scoring import Scored

type Category = Literal["project", "goal", "concept", "topic", "fresh", "trusted"]
CATEGORIES: tuple[str, ...] = get_args(Category.__value__)
# What each category's evidence supplies: a template may use only these.
VARIABLES: dict[Category, frozenset[str]] = {
    "project": frozenset({"technology", "concept"}),
    "goal": frozenset({"goal", "concept"}),
    "concept": frozenset({"concept", "prerequisite"}),
    "topic": frozenset({"topic"}),
    "fresh": frozenset({"source"}),
    "trusted": frozenset({"source"}),
}
MIN_PER_CATEGORY = 2
NOTE_MAX_CHARS = 300  # feed_note's own limit
# Relative to the working directory (the repo root; /app in the image), as the other
# seed files are: the installed package doesn't sit next to workers/jobs/seeds.
LIBRARY_FILE = Path("workers/jobs/seeds/explanations.yaml")

# The top reason's category. Level and break length are on the card already, so those
# cards get a concept-graph connection or nothing.
SIGNAL_CATEGORY: dict[str, Category] = {
    "project_match": "project",
    "goal_match": "goal",
    "topic_match": "topic",
    "freshness": "fresh",
    "quality": "trusted",
    "level_fit": "concept",
    "time_fit": "concept",
}

TRUSTED_QUALITY = 4  # "most trusted": a source rated 4 or 5 (ING-6)
FRESH = timedelta(days=7)

# How a goal reads (ADR-0015, owner 2026-10-26); only goals that point at concepts can
# be a card's reason.
GOAL_WORDS: dict[LearningGoal, str] = {
    "system-design-interviews": "pass system design interviews",
    "stack-i-use": "get better at the stack you use",
}

type GoalSets = tuple[tuple[LearningGoal, frozenset[str]], ...]

_PLACEHOLDER = re.compile(r"\{([a-z]+)\}")


class LibraryError(ValueError):
    pass


@dataclass(frozen=True)
class Template:
    id: str
    category: Category
    text: str


def parse_library(text: str, where: str) -> dict[Category, tuple[Template, ...]]:
    """The templates by category; LibraryError names what's wrong."""
    data: object = yaml.safe_load(text)
    if not isinstance(data, dict):
        raise LibraryError(f"{where}: must be a mapping")
    entries = cast(dict[str, object], data).get("templates")
    if not isinstance(entries, list):
        raise LibraryError(f"{where}: needs `templates`")
    by_category: dict[Category, list[Template]] = {}
    ids: set[str] = set()
    for raw in cast(list[object], entries):
        if not isinstance(raw, dict):
            raise LibraryError(f"{where}: each template must be a mapping")
        entry = cast(dict[str, object], raw)
        tid, category, body = entry.get("id"), entry.get("category"), entry.get("text")
        if not isinstance(tid, str) or not tid or tid in ids:
            raise LibraryError(f"{where}: missing or repeated id {tid!r}")
        if category not in CATEGORIES:
            raise LibraryError(f"{where}: {tid}: unknown category {category!r}")
        if not isinstance(body, str) or not 1 <= len(body) <= 200:
            raise LibraryError(f"{where}: {tid}: needs text of 1-200 characters")
        known = cast(Category, category)
        variables = frozenset(_PLACEHOLDER.findall(body))
        unknown = variables - VARIABLES[known]
        rest = _PLACEHOLDER.sub("", body)
        if unknown or "{" in rest or "}" in rest:
            raise LibraryError(
                f"{where}: {tid}: placeholder {sorted(unknown)} not supplied for "
                f"{category} (or a stray brace)"
            )
        ids.add(tid)
        by_category.setdefault(known, []).append(Template(tid, known, body))
    for category in CATEGORIES:
        if len(by_category.get(cast(Category, category), [])) < MIN_PER_CATEGORY:
            raise LibraryError(
                f"{where}: {category} needs at least {MIN_PER_CATEGORY} templates"
            )
    return {c: tuple(t) for c, t in by_category.items()}


@cache
def library() -> dict[Category, tuple[Template, ...]]:
    return parse_library(LIBRARY_FILE.read_text("utf-8"), str(LIBRARY_FILE))


@dataclass(frozen=True)
class ConceptMap:
    """Live concepts' names, and each one's direct prerequisites, by slug."""

    names: dict[str, str]
    prerequisites: dict[str, tuple[str, ...]]


def concept_map(graph: ConceptGraph | None) -> ConceptMap:
    if graph is None:
        return ConceptMap({}, {})
    names = {c.slug: c.name for c in graph.concepts if not c.retired}
    before: dict[str, list[str]] = {}
    for a, b, kind in graph.edges:
        if kind == "prerequisite_of" and a in names and b in names:
            before.setdefault(b, []).append(a)
    return ConceptMap(names, {b: tuple(sorted(a)) for b, a in before.items()})


def _words(slug: str) -> str:
    return slug.replace("-", " ")


def _values(
    category: Category,
    scored: Scored,
    topics: list[Topic],
    now: datetime,
    goals: GoalSets,
    projects: ProjectConcepts,
    concepts: ConceptMap,
) -> tuple[str, dict[str, str]] | None:
    """The detail that keys the note, and the template variables; None when the
    category's words wouldn't be true of this entry."""
    facts = scored.facts
    named = sorted(c for c in facts.concepts if c in concepts.names)
    if category == "project":
        concept = next((c for c in named if projects.get(c)), None)
        if concept is None:
            return None
        slug, name = projects[concept][0]
        # The concept depends on the user's projects: it keys the shared note too.
        return f"{slug}:{concept}", {
            "technology": name,
            "concept": concepts.names[concept],
        }
    if category == "goal":
        for goal, goal_concepts in goals:
            hit = next((c for c in named if c in goal_concepts), None)
            if hit is not None and goal in GOAL_WORDS:
                return f"{goal}:{hit}", {
                    "goal": GOAL_WORDS[goal],
                    "concept": concepts.names[hit],
                }
        return None
    if category == "concept":
        concept = next((c for c in named if concepts.prerequisites.get(c)), None)
        if concept is None:
            return None
        before = concepts.prerequisites[concept][0]
        return concept, {
            "concept": concepts.names[concept],
            "prerequisite": concepts.names[before],
        }
    if category == "topic":
        topic = next((t for t in topics if t in facts.topics), None)
        return None if topic is None else (topic, {"topic": _words(topic)})
    if category == "fresh":
        if facts.published_at is None or now - facts.published_at > FRESH:
            return None
        return "", {"source": facts.source_name}
    if facts.quality is None or facts.quality < TRUSTED_QUALITY:
        return None
    return "", {"source": facts.source_name}


def explain(
    scored: Scored,
    topics: list[Topic],
    level: Difficulty,
    now: datetime,
    goals: GoalSets,
    projects: ProjectConcepts,
    concepts: ConceptMap,
) -> tuple[NoteKey, str] | None:
    """The note's key and text, or None: nothing true and useful to add."""
    category = SIGNAL_CATEGORY.get(scored.top_signal)
    if category is None:
        return None
    found = _values(category, scored, topics, now, goals, projects, concepts)
    if found is None:
        return None
    detail, values = found
    templates = library()[category]
    digest = hashlib.sha256(f"{scored.item_id}:{category}".encode()).digest()
    template = templates[int.from_bytes(digest[:8]) % len(templates)]
    text = template.text.format_map(values)
    if len(text) > NOTE_MAX_CHARS:
        log.warn("feed: explanation too long, left out", item_id=scored.item_id)
        return None
    # The template's own words key the note too, so an edited template reaches notes
    # already written under its id.
    words = hashlib.sha256(template.text.encode()).hexdigest()[:8]
    variant = f"{template.id}.{words}:{detail}"
    return NoteKey(scored.item_id, category, level, variant), text
