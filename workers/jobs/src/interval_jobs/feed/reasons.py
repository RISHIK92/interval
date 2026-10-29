"""Card explanations (ADR-0027): one plain sentence per card, rendered from the entry's
own breakdown at recompute, with no model. The first that holds of the project
connection, the learning goal, an exploration pick, fresh, trusted; else a neutral
phrase. A reason is stated only when its facts hold. The template is chosen by a
stable hash of the card and its facts, so the wording changes only when they do.
Templates: workers/jobs/seeds/reasons.yaml.
"""

import hashlib
import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import cache
from pathlib import Path
from typing import cast

import yaml

from interval_db.generated import LearningGoal
from interval_jobs.ports import ConceptGraph, ProjectConcepts
from interval_jobs.ranking.scoring import Scored

# Each category's facts: its templates must use exactly these (the loader checks), so
# whichever one is drawn says the same thing.
FACTS: dict[str, frozenset[str]] = {
    "project": frozenset({"technology", "repositories", "concept"}),
    "goal": frozenset({"concept"}),
    "explore": frozenset(),  # a topic exploration pick (REC-4)
    "fresh": frozenset({"source"}),
    "trusted": frozenset({"source"}),
    "neutral": frozenset(),
}
# Facts a template may leave out (the rest it must use): a project line always names
# the repository and the concept; the technology is optional.
OPTIONAL: dict[str, frozenset[str]] = {"project": frozenset({"technology"})}
# The reason each category states, as the feed entry's reason_kinds and "a reason is
# wrong" name it; a neutral phrase states none.
KIND: dict[str, str | None] = {
    "project": "project_match",
    "goal": "goal_match",
    "explore": "explore",
    "fresh": "freshness",
    "trusted": "quality",
    "neutral": None,
}
MIN_TEMPLATES = 2
REASON_THRESHOLD = 0.1  # a weighted part below this didn't really count
REPOSITORIES_SHOWN = 2  # then "and N more"
TRUSTED_QUALITY = 4  # "best-rated": a source rated 4 or 5 (ING-6)
FRESH = timedelta(days=7)
TEMPLATES_FILE = Path("workers/jobs/seeds/reasons.yaml")  # from the repo root, as seeds

type GoalSets = tuple[tuple[LearningGoal, frozenset[str]], ...]

_FACT = re.compile(r"\{([a-z]+)\}")
# No verb right after a concept: names may be singular or plural.
_VERB_AFTER_CONCEPT = re.compile(
    r"\{concept\} (is|are|was|were|has|have|comes|come|covers|cover)\b"
)


class TemplatesError(ValueError):
    pass


@dataclass(frozen=True)
class Templates:
    by_category: dict[str, tuple[str, ...]]  # every category but goal
    goal: dict[str, tuple[str, ...]]  # by goal


def _list(
    raw: object, what: str, facts: frozenset[str], optional: frozenset[str]
) -> tuple[str, ...]:
    if not isinstance(raw, list) or len(cast(list[object], raw)) < MIN_TEMPLATES:
        raise TemplatesError(f"{what} needs at least {MIN_TEMPLATES} templates")
    out: list[str] = []
    for item in cast(list[object], raw):
        if not isinstance(item, str) or not 1 <= len(item) <= 160:
            raise TemplatesError(f"{what}: each template is 1-160 characters")
        used = frozenset(_FACT.findall(item))
        if not facts - optional <= used <= facts:
            raise TemplatesError(
                f"{what}: {item!r} must use {sorted(facts - optional)}, "
                f"may use {sorted(optional)}, nothing else"
            )
        if any(c in _FACT.sub("", item) for c in "{}"):
            raise TemplatesError(f"{what}: stray brace in {item!r}")
        if _VERB_AFTER_CONCEPT.search(item):
            raise TemplatesError(f"{what}: {item!r} puts a verb after the concept")
        if not (item[:1].isupper() or item.startswith("{")):
            raise TemplatesError(f"{what}: {item!r} must start with a capital")
        if not item.endswith((".", "!", "?")):
            raise TemplatesError(f"{what}: {item!r} must end a sentence")
        out.append(item)
    return tuple(out)


def parse_templates(text: str, where: str) -> Templates:
    """The templates; TemplatesError names what's wrong."""
    data: object = yaml.safe_load(text)
    if not isinstance(data, dict):
        raise TemplatesError(f"{where}: must be a mapping")
    doc = cast(dict[str, object], data)
    if set(doc) != set(FACTS):
        raise TemplatesError(f"{where}: categories must be exactly {sorted(FACTS)}")
    raw_goal = doc["goal"]
    if not isinstance(raw_goal, dict) or not raw_goal:
        raise TemplatesError(f"{where}: goal needs templates per goal")
    goal = {
        str(name): _list(items, f"{where}: goal {name}", FACTS["goal"], frozenset())
        for name, items in cast(dict[object, object], raw_goal).items()
    }
    by_category = {
        name: _list(
            doc[name], f"{where}: {name}", FACTS[name], OPTIONAL.get(name, frozenset())
        )
        for name in FACTS
        if name != "goal"
    }
    return Templates(by_category, goal)


@cache
def templates() -> Templates:
    return parse_templates(TEMPLATES_FILE.read_text("utf-8"), str(TEMPLATES_FILE))


@dataclass(frozen=True)
class ConceptMap:
    """Live concepts' names, by slug."""

    names: dict[str, str]


def concept_map(graph: ConceptGraph | None) -> ConceptMap:
    if graph is None:
        return ConceptMap({})
    return ConceptMap({c.slug: c.name for c in graph.concepts if not c.retired})


def _repositories(full_names: Sequence[str]) -> str:
    """Short names ("company-brain"), two named, then "and N more"."""
    short = [name.rsplit("/", 1)[-1] for name in full_names]
    items = short[:REPOSITORIES_SHOWN]
    if len(short) > REPOSITORIES_SHOWN:
        items.append(f"{len(short) - REPOSITORIES_SHOWN} more")
    if len(items) <= 1:
        return "".join(items)
    return f"{', '.join(items[:-1])} and {items[-1]}"


@dataclass(frozen=True)
class Explanation:
    text: str
    kind: str | None  # the reason it states; None for a neutral phrase


def explain(
    scored: Scored,
    now: datetime,
    goals: GoalSets,
    projects: ProjectConcepts,
    repositories: dict[str, tuple[str, ...]],
    concepts: ConceptMap,
    rules: Templates | None = None,
) -> Explanation:
    """The card's one sentence. A starter feed passes no goals, projects or
    repositories, so it never states a goal, a project or a repository."""
    t = rules or templates()
    facts, weighted = scored.facts, scored.breakdown.weighted
    named = sorted(c for c in facts.concepts if c in concepts.names)

    def counted(kind: str) -> bool:
        return weighted.get(kind, 0.0) >= REASON_THRESHOLD

    category, values = "neutral", {}
    choices: tuple[str, ...] = ()
    # The first concept and technology the user's repositories actually back.
    backed = next(
        (
            (concept, name, repositories[slug])
            for concept in named
            for slug, name in projects.get(concept, ())
            if repositories.get(slug)
        ),
        None,
    )
    if counted("project_match") and backed is not None:
        concept, name, repos = backed
        category = "project"
        values = {
            "technology": name,
            "repositories": _repositories(repos),
            "concept": concepts.names[concept],
        }
    if category == "neutral" and counted("goal_match"):
        for goal, goal_concepts in goals:
            hit = next((c for c in named if c in goal_concepts), None)
            if hit is not None and goal in t.goal:
                category, choices = "goal", t.goal[goal]
                values = {"concept": concepts.names[hit]}
                break
    # Only a topic pick is "beyond your usual topics": a source pick is just one the
    # chip's main picks didn't reach, maybe one the user reads often, so it claims no
    # novelty and falls through.
    if category == "neutral" and scored.arm is not None and scored.arm.kind == "topic":
        category = "explore"
    if (
        category == "neutral"
        and counted("freshness")
        and facts.published_at is not None
        and now - facts.published_at <= FRESH
    ):
        category, values = "fresh", {"source": facts.source_name}
    if (
        category == "neutral"
        and counted("quality")
        and facts.quality is not None
        and facts.quality >= TRUSTED_QUALITY
    ):
        category, values = "trusted", {"source": facts.source_name}
    choices = choices or t.by_category[category]
    # The card and its facts pick the wording: stable until they change.
    key = f"{scored.item_id}:{category}:{sorted(values.items())}"
    digest = hashlib.sha256(key.encode()).digest()
    template = choices[int.from_bytes(digest[:8]) % len(choices)]
    return Explanation(template.format_map(values), KIND[category])
