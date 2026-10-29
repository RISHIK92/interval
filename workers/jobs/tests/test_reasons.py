""" "Shown for" reasons (ADR-0026): every reason that counted, rendered from the
entry's breakdown through a grammar, varied but never changing what is said."""

import re
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from interval_jobs.feed.reasons import (
    GRAMMAR_FILE,
    LINE_MAX,
    REASON_FACTS,
    Chooser,
    ConceptMap,
    GoalSets,
    GrammarError,
    Reason,
    grammar,
    parse_grammar,
    reasons_for,
    render,
    seeded,
    with_article,
)
from interval_jobs.ports import Arm, Breakdown, EntryFacts, ProjectConcepts
from interval_jobs.ranking.scoring import Scored

NOW = datetime(2026, 10, 29, 12, tzinfo=UTC)
# The Tailscale card from the owner's feed (2026-10-29), as the ranking scored it.
TAILSCALE = EntryFacts(
    moment_id=7,
    item_id=35089,
    source_id=700,
    minutes=3,
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
CONCEPTS = ConceptMap({"rate-limiting": "Rate limiting"})
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
        # Every raw part a full fit, unless a test says otherwise.
        Breakdown({k: 1.0 for k in parts}, {}, parts, 0),
        arm,
    )


def reasons(s: Scored | None = None) -> list[Reason]:
    return reasons_for(
        s or scored(),
        ["system-design", "distributed-systems", "backend"],
        "intermediate",
        NOW,
        GOALS,
        PROJECTS,
        REPOS,
        CONCEPTS,
    )


def test_the_tailscale_card_gives_exactly_the_reasons_that_counted() -> None:
    found = reasons()
    assert [r.kind for r in found] == [
        "topic_match",
        "goal_match",
        "project_match",
        "time_fit",
        "level_fit",
    ]
    by_kind = {r.kind: r.facts for r in found}
    assert by_kind["topic_match"] == {"topics": "distributed systems and backend"}
    assert by_kind["goal_match"] == {
        "goal": "pass system design interviews",
        "concept": "Rate limiting",
    }
    assert by_kind["project_match"] == {
        "technology": "LLM SDKs",
        "repositories": "RISHIK92/company-brain",
        "concept": "Rate limiting",
    }
    # An unrated source's neutral 0.5 and a seven-week-old post claim nothing.
    assert "quality" not in by_kind and "freshness" not in by_kind


def test_true_quality_and_freshness_are_said_and_weak_parts_are_not() -> None:
    fresh = replace(TAILSCALE, quality=5, published_at=NOW - timedelta(days=2))
    kinds = [r.kind for r in reasons(scored(fresh, {**WEIGHTED, "freshness": 0.4}))]
    assert "quality" in kinds and "freshness" in kinds
    weak = {k: 0.05 for k in WEIGHTED}
    assert reasons(scored(weighted=weak)) == []


def test_an_exploration_pick_says_so_first() -> None:
    found = reasons(scored(arm=Arm("topic", "system-design")))
    assert found[0] == Reason("explore", {"arm": "system design"})


def test_no_project_reason_without_the_users_repositories() -> None:
    found = reasons_for(scored(), [], "intermediate", NOW, (), PROJECTS, {}, CONCEPTS)
    assert "project_match" not in [r.kind for r in found]


def test_a_line_carries_every_fact_whichever_wording_is_drawn() -> None:
    found = reasons()
    for n in range(200):
        line = render(found, Chooser(), seeded("u1", 35089, "3-8", n))
        assert line is not None
        for reason in found:
            for value in reason.facts.values():
                assert value in line
        assert not re.search(r"[{}#]", line)


def test_every_frame_and_symbol_expands_to_its_facts() -> None:
    rules = grammar()
    sample = {
        "arm": "system design",
        "topics": "backend",
        "goal": "pass system design interviews",
        "concept": "Rate limiting",
        "technology": "LLM SDKs",
        "repositories": "octo/velox",
        "level": "intermediate",
        "minutes": "8",
        "source": "Tailscale Blog",
    }
    for kind, frames in rules.frames.items():
        for index in range(len(frames)):
            # Drawn many times so every symbol option comes up.
            for n in range(30):
                facts = {f: sample[f] for f in REASON_FACTS[kind]}
                one = replace(rules, frames={**rules.frames, kind: (frames[index],)})
                line = render([Reason(kind, facts)], Chooser(), seeded(n), one)
                assert line is not None and not re.search(r"[{}#]", line)
                assert all(v in line for v in facts.values())


def test_neighbouring_cards_do_not_share_a_line() -> None:
    chooser = Chooser()
    lines = [
        render(reasons(scored(replace(TAILSCALE, item_id=i))), chooser, seeded(i))
        for i in range(50)
    ]
    assert len(set(lines)) == 50
    # No lead repeats within any 5 neighbouring cards.
    leads = [line.split(":")[0] if line else "" for line in lines]
    for start in range(len(leads) - 4):
        assert len(set(leads[start : start + 5])) == 5


def test_the_same_seed_gives_the_same_line_and_hours_differ() -> None:
    found = reasons()
    one = render(found, Chooser(), seeded("u1", 35089, "3-8", "2026102912"))
    again = render(found, Chooser(), seeded("u1", 35089, "3-8", "2026102912"))
    assert one == again
    hours = {
        render(found, Chooser(), seeded("u1", 35089, "3-8", f"20261029{h:02}"))
        for h in range(24)
    }
    assert len(hours) > 5


def test_nothing_that_counted_gives_no_line() -> None:
    assert render([], Chooser(), seeded(1)) is None


@pytest.mark.parametrize(
    ("word", "expected"),
    [
        ("intermediate", "an intermediate"),
        ("beginner", "a beginner"),
        ("8", "an 8"),
        ("11", "an 11"),
        ("18", "an 18"),
        ("80", "an 80"),
        ("3", "a 3"),
        ("12", "a 12"),
    ],
)
def test_a_or_an_follows_the_sound(word: str, expected: str) -> None:
    assert with_article(word) == expected


@pytest.mark.parametrize(
    ("edit", "error"),
    [
        ('"your interest in {topics}"', None),
        ('"your interest in {topic}"', "must use exactly"),
        ('"your interest in {topics} and {source}"', "must use exactly"),
        ('"your #nope# {topics}"', "unknown symbol"),
        ('"your interest in {topics}}"', "stray"),
    ],
)
def test_the_loader_checks_every_frame(edit: str, error: str | None) -> None:
    text = GRAMMAR_FILE.read_text("utf-8").replace('"your interest in {topics}"', edit)
    if error is None:
        parse_grammar(text, "t.yaml")
    else:
        with pytest.raises(GrammarError, match=error):
            parse_grammar(text, "t.yaml")


# A partial fit to the break isn't "short": the reason is left out.
def test_a_partial_break_fit_is_not_stated() -> None:
    partial = scored()
    partial = replace(
        partial,
        breakdown=replace(
            partial.breakdown, values={**partial.breakdown.values, "time_fit": 0.25}
        ),
    )
    assert "time_fit" not in [r.kind for r in reasons(partial)]


# AI-3: concepts in goal and project reasons are model tags, and the line says so.
def test_goal_and_project_reasons_say_the_concept_is_a_tag() -> None:
    found = [r for r in reasons() if r.kind in ("goal_match", "project_match")]
    for n in range(40):
        line = render(found, Chooser(), seeded(n))
        assert line is not None and line.count("tagged") == 2
    text = GRAMMAR_FILE.read_text("utf-8").replace(
        '"your goal to {goal} (tagged {concept})"',
        '"your goal to {goal} ({concept})"',
    )
    with pytest.raises(GrammarError, match="must say tagged"):
        parse_grammar(text, "t.yaml")


# Many repositories can't overflow the stored line: two are named, then "N more", and
# a line past the limit folds its smallest reasons into "+N more".
def test_a_long_line_stays_within_the_limit() -> None:
    many = {"llm-sdks": tuple(f"octo/repository-number-{n:03}" for n in range(40))}
    found = reasons_for(
        scored(),
        ["system-design", "distributed-systems", "backend"],
        "intermediate",
        NOW,
        GOALS,
        PROJECTS,
        many,
        CONCEPTS,
    )
    project = next(r for r in found if r.kind == "project_match")
    assert project.facts["repositories"] == (
        "octo/repository-number-000, octo/repository-number-001 and 38 more"
    )
    huge = [Reason("topic_match", {"topics": "x" * 200}) for _ in range(6)]
    line = render(huge, Chooser(), seeded(1))
    assert line is not None and len(line) <= LINE_MAX and "more" in line
