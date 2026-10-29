"""Card explanations (ADR-0027): one plain sentence per card, the first that holds of
project, goal, exploration, fresh, trusted, else neutral; stable until the facts
change."""

import re
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from interval_jobs.feed.reasons import (
    TEMPLATES_FILE,
    ConceptMap,
    GoalSets,
    TemplatesError,
    explain,
    parse_templates,
    templates,
)
from interval_jobs.ports import Arm, Breakdown, EntryFacts, ProjectConcepts
from interval_jobs.ranking.scoring import Scored

NOW = datetime(2026, 10, 29, 12, tzinfo=UTC)
# The Tailscale card from the owner's feed (2026-10-29), as the ranking scored it.
TAILSCALE = EntryFacts(
    moment_id=7,
    item_id=35089,
    source_id=700,
    minutes=1,
    difficulty="intermediate",
    published_at=datetime(2026, 9, 9, tzinfo=UTC),
    quality=None,
    concepts=frozenset({"rate-limiting"}),
    topics=frozenset({"backend", "distributed-systems"}),
    source_name="Tailscale Blog",
)
WEIGHTED = {
    "topic_match": 1.0,
    "goal_match": 0.8,
    "project_match": 0.8,
    "time_fit": 0.7,
    "level_fit": 0.6,
    "quality": 0.2,
    "freshness": 0.04,
}
CONCEPTS = ConceptMap({"rate-limiting": "Rate limiting", "indexes": "Indexes"})
GOALS: GoalSets = (("system-design-interviews", frozenset({"rate-limiting"})),)
PROJECTS: ProjectConcepts = {"rate-limiting": (("llm-sdks", "LLM SDKs"),)}
REPOS = {"llm-sdks": ("RISHIK92/company-brain",)}


def scored(
    facts: EntryFacts = TAILSCALE,
    weighted: dict[str, float] | None = None,
    arm: Arm | None = None,
) -> Scored:
    parts = WEIGHTED if weighted is None else weighted
    return Scored(
        7,
        facts.item_id,
        700,
        sum(parts.values()),
        max(parts, key=lambda k: parts[k]),
        facts,
        Breakdown({k: 1.0 for k in parts}, {}, parts, 0),
        arm,
    )


def say(
    s: Scored | None = None,
    goals: GoalSets = GOALS,
    projects: ProjectConcepts = PROJECTS,
    repos: dict[str, tuple[str, ...]] = REPOS,
) -> tuple[str, str | None]:
    found = explain(s or scored(), NOW, goals, projects, repos, CONCEPTS)
    return found.text, found.kind


def test_the_project_connection_comes_first_and_names_the_short_repository() -> None:
    text, kind = say()
    assert kind == "project_match"
    assert "company-brain" in text and "RISHIK92/" not in text
    assert "Rate limiting" in text


def test_then_the_goal_then_nothing_personal() -> None:
    text, kind = say(projects={})
    assert kind == "goal_match"
    assert "system design interviews" in text and "Rate limiting" in text
    # No goal or project: a neutral phrase (the post is seven weeks old, unrated).
    text, kind = say(goals=(), projects={})
    assert kind is None
    assert text in templates().by_category["neutral"]


def test_only_a_topic_pick_claims_exploration() -> None:
    topic_pick = scored(arm=Arm("topic", "system-design"))
    text, kind = say(topic_pick, goals=(), projects={})
    assert kind == "explore" and text in templates().by_category["explore"]
    # A source pick is only one the chip's main picks didn't reach: no novelty claimed.
    _, kind = say(scored(arm=Arm("source", "700")), goals=(), projects={})
    assert kind is None


def test_the_project_line_finds_a_technology_the_repositories_back() -> None:
    # The first technology on the concept has no repositories; the second does.
    projects: ProjectConcepts = {
        "rate-limiting": (("unused", "Unused"), ("llm-sdks", "LLM SDKs"))
    }
    text, kind = say(projects=projects)
    assert kind == "project_match" and "company-brain" in text


def test_fresh_and_trusted_only_when_true() -> None:
    fresh = replace(TAILSCALE, published_at=NOW - timedelta(days=2))
    parts = {**WEIGHTED, "freshness": 0.4}
    text, kind = say(scored(fresh, parts), goals=(), projects={})
    assert kind == "freshness" and "Tailscale Blog" in text
    rated = replace(TAILSCALE, quality=5)
    text, kind = say(scored(rated), goals=(), projects={})
    assert kind == "quality" and "Tailscale Blog" in text
    # An unrated source isn't called best-rated; an old post isn't new.
    _, kind = say(goals=(), projects={})
    assert kind is None


def test_a_weak_part_states_nothing() -> None:
    weak = {**WEIGHTED, "project_match": 0.05, "goal_match": 0.05}
    _, kind = say(scored(weighted=weak))
    assert kind is None


def test_many_repositories_name_two_then_a_count() -> None:
    many = {"llm-sdks": tuple(f"octo/repo-{n}" for n in range(9))}
    text, _ = say(repos=many)
    assert "repo-0, repo-1 and 7 more" in text


def test_wording_is_stable_until_the_facts_change() -> None:
    first, _ = say()
    assert say() == (first, "project_match")
    seen = {say(scored(replace(TAILSCALE, item_id=i)))[0] for i in range(40)}
    assert len(seen) > 1  # cards spread across the templates


def test_every_template_reads_with_singular_and_plural_concepts() -> None:
    t = templates()
    sample = {
        "technology": "PostgreSQL",
        "repositories": "velox",
        "source": "Tailscale Blog",
    }
    for concept in ("Rate limiting", "Approximate nearest neighbour indexes"):
        values = {**sample, "concept": concept}
        lists = [*t.by_category.values(), *t.goal.values()]
        for template in (x for options in lists for x in options):
            line = template.format_map(values)
            assert not re.search(r"[{}]|  ", line)
            assert line[0].isupper() and line.endswith((".", "!", "?"))
            # No verb right after a concept name of either number.
            assert not re.search(rf"{concept} (is|are|comes|covers)\b", line)


@pytest.mark.parametrize(
    ("old", "new", "error"),
    [
        ('"Worth a look."', '"worth a look."', "capital"),
        ('"Worth a look."', '"Worth a look"', "end a sentence"),
        (
            '"System design interviews ask about {concept}."',
            '"{concept} comes up in system design interviews."',
            "verb after the concept",
        ),
        ('"New this week from {source}."', '"New this week."', "must use"),
        (
            '"Homework for {repositories}: {concept}."',
            '"Homework: {concept}."',
            "must use",
        ),
    ],
)
def test_the_loader_refuses_a_bad_template(old: str, new: str, error: str) -> None:
    text = TEMPLATES_FILE.read_text("utf-8")
    assert old in text
    with pytest.raises(TemplatesError, match=error):
        parse_templates(text.replace(old, new), "t.yaml")
