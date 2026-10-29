"""Card explanations (ADR-0025, Q-P2-45): one per card at most, from a template library
filled only from stored data, chosen by a stable hash of the item; no model."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import get_args

import pytest

from interval_db.generated import Topic
from interval_jobs.feed.explain import (
    LIBRARY_FILE,
    ConceptMap,
    GoalSets,
    LibraryError,
    concept_map,
    explain,
    library,
    parse_library,
)
from interval_jobs.ports import (
    Breakdown,
    ConceptGraph,
    ConceptSeed,
    EntryFacts,
    ProjectConcepts,
)
from interval_jobs.ranking.scoring import Scored

NOW = datetime(2026, 10, 29, 12, tzinfo=UTC)
FACTS = EntryFacts(
    moment_id=7,
    item_id=70,
    source_id=700,
    minutes=5,
    difficulty="intermediate",
    published_at=NOW,
    quality=5,
    concepts=frozenset({"mvcc", "caching"}),
    topics=frozenset({"databases"}),
    source_name="PlanetScale",
)
CONCEPTS = ConceptMap(
    {"mvcc": "MVCC", "caching": "Caching", "transactions": "Transactions"},
    {"mvcc": ("transactions",)},
)
GOALS: GoalSets = (("system-design-interviews", frozenset({"caching"})),)
PROJECTS: ProjectConcepts = {"mvcc": (("postgresql", "PostgreSQL"),)}


def scored(signal: str, facts: EntryFacts = FACTS) -> Scored:
    return Scored(7, facts.item_id, 700, 1.0, signal, facts, Breakdown({}, {}, {}, 0))


def text_for(
    signal: str,
    facts: EntryFacts = FACTS,
    topics: list[Topic] | None = None,
    concepts: ConceptMap = CONCEPTS,
) -> str | None:
    found = explain(
        scored(signal, facts),
        ["databases"] if topics is None else topics,
        "intermediate",
        NOW,
        GOALS,
        PROJECTS,
        concepts,
    )
    return None if found is None else found[1]


def test_the_real_library_loads_with_every_category() -> None:
    templates = library()
    assert set(templates) == {"project", "goal", "concept", "topic", "fresh", "trusted"}
    assert LIBRARY_FILE.name == "explanations.yaml"


@pytest.mark.parametrize(
    ("body", "error"),
    [
        (
            "templates: [{id: a, category: topic, text: 'On {nope}.'}]",
            "not supplied",
        ),
        (
            "templates: [{id: a, category: weird, text: 'x'}]",
            "unknown category",
        ),
        (
            "templates: [{id: a, category: topic, text: 'x'},"
            " {id: a, category: topic, text: 'y'}]",
            "repeated id",
        ),
        ("templates: [{id: a, category: topic, text: 'x'}]", "at least 2"),
    ],
)
def test_a_bad_library_is_refused(body: str, error: str) -> None:
    with pytest.raises(LibraryError, match=error):
        parse_library(body, "t.yaml")


def test_each_reason_reads_from_its_own_category_and_grounded_values() -> None:
    project = text_for("project_match")
    assert project is not None and "PostgreSQL" in project and "MVCC" in project
    goal = text_for("goal_match")
    assert goal is not None and "pass system design interviews" in goal
    assert "Caching" in goal  # the goal's concept the item has: the pick's reason
    topic = text_for("topic_match")
    assert topic is not None and "databases" in topic
    assert "PlanetScale" in (text_for("freshness") or "")
    assert "PlanetScale" in (text_for("quality") or "")
    for signal in ("level_fit", "time_fit"):
        connection = text_for(signal)
        assert connection is not None
        assert "MVCC" in connection and "Transactions" in connection


def test_nothing_is_said_that_the_data_does_not_hold() -> None:
    nothing = replace(
        FACTS, concepts=frozenset(), topics=frozenset(), published_at=None, quality=3
    )
    for signal in (
        "project_match",
        "goal_match",
        "topic_match",
        "freshness",
        "quality",
        "level_fit",
        "time_fit",
    ):
        assert text_for(signal, nothing) is None
    # Old news, and a level-led card without a prerequisite in the graph.
    assert (
        text_for("freshness", replace(FACTS, published_at=NOW - timedelta(days=8)))
        is None
    )
    assert text_for("level_fit", concepts=replace(CONCEPTS, prerequisites={})) is None


def test_a_signal_with_no_category_gets_nothing() -> None:
    assert text_for("similar") is None


def test_no_template_leaves_a_placeholder_and_none_names_a_repository() -> None:
    for item in range(1, 60):
        facts = replace(FACTS, item_id=item)
        for signal in (
            "project_match",
            "goal_match",
            "topic_match",
            "freshness",
            "quality",
            "level_fit",
        ):
            text = text_for(signal, facts)
            assert text is not None and "{" not in text and "/" not in text


def test_the_same_item_always_reads_the_same_and_items_vary() -> None:
    assert text_for("topic_match") == text_for("topic_match")
    seen = {text_for("topic_match", replace(FACTS, item_id=i)) for i in range(1, 40)}
    assert len(seen) > 1  # the hash spreads the templates


def test_the_key_names_the_category_template_and_detail() -> None:
    found = explain(
        scored("topic_match"), ["databases"], "beginner", NOW, (), {}, CONCEPTS
    )
    assert found is not None
    key = found[0]
    assert (key.item_id, key.signal, key.level) == (70, "topic", "beginner")
    assert key.variant.startswith("topic-") and key.variant.endswith(":databases")


def test_the_concept_map_keeps_live_concepts_and_direct_prerequisites() -> None:
    graph = ConceptGraph(
        1,
        [
            ConceptSeed("a", "A", "databases", None, False, None),
            ConceptSeed("b", "B", "databases", None, False, None),
            ConceptSeed("gone", "Gone", "databases", None, True, None),
        ],
        {("a", "b", "prerequisite_of"), ("gone", "b", "prerequisite_of")},
    )
    found = concept_map(graph)
    assert found.names == {"a": "A", "b": "B"}
    assert found.prerequisites == {"b": ("a",)}
    assert concept_map(None) == ConceptMap({}, {})


def test_topics_are_the_ones_the_user_chose() -> None:
    assert text_for("topic_match", topics=["backend"]) is None
    assert set(get_args(Topic.__value__)) >= {"databases"}


def test_a_placeholder_its_category_cannot_fill_is_refused() -> None:
    body = (
        "templates: [{id: a, category: topic, text: 'From {source}.'},"
        " {id: b, category: topic, text: 'On {topic}.'}]"
    )
    with pytest.raises(LibraryError, match="not supplied"):
        parse_library(body, "t.yaml")
    with pytest.raises(LibraryError, match="stray brace"):
        parse_library(
            "templates: [{id: a, category: topic, text: 'On {topic}}.'}]", "t.yaml"
        )


# Notes are shared: two users whose projects reach the item through different
# concepts must not share one text that names the other's concept.
def test_project_and_goal_notes_key_the_concept_they_name() -> None:
    facts = replace(FACTS, concepts=frozenset({"mvcc", "caching"}))
    mine = explain(
        scored("project_match", facts),
        [],
        "beginner",
        NOW,
        (),
        {"mvcc": (("postgresql", "PostgreSQL"),)},
        CONCEPTS,
    )
    theirs = explain(
        scored("project_match", facts),
        [],
        "beginner",
        NOW,
        (),
        {"caching": (("postgresql", "PostgreSQL"),)},
        CONCEPTS,
    )
    assert mine is not None and theirs is not None
    assert mine[0] != theirs[0]
    assert "MVCC" in mine[1] and "Caching" in theirs[1]


def test_a_concept_without_a_live_name_is_never_named() -> None:
    retired = replace(CONCEPTS, names={"caching": "Caching"})  # mvcc retired
    assert text_for("project_match", concepts=retired) is None
    assert text_for("level_fit", concepts=retired) is None
