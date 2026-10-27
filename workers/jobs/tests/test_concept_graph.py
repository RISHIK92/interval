"""The concept seed file (DB-2, §3.1, Q-P1-03, Q-P1-04): parsed and validated before
anything is written."""

from pathlib import Path

import pytest

from interval_jobs.concepts.graph import ConceptSeedError, parse_concepts
from interval_jobs.ports import ConceptCycleError

SEED = Path(__file__).resolve().parents[1] / "seeds" / "concepts.yaml"


def seed(body: str, version: int = 1) -> str:
    return f"version: {version}\nconcepts:\n{body}"


TWO = """
  - {slug: replication, name: Replication, topic: distributed-systems}
  - slug: replication-lag
    name: Replication lag
    topic: distributed-systems
    prerequisites: [replication]
"""


def test_concepts_and_typed_edges_are_read() -> None:
    graph = parse_concepts(seed(TWO), "c.yaml")
    assert graph.version == 1
    assert [c.slug for c in graph.concepts] == ["replication", "replication-lag"]
    assert graph.edges == {("replication", "replication-lag", "prerequisite_of")}


@pytest.mark.parametrize(
    ("body", "message"),
    [
        (TWO + "    depends_on: [replication]\n", "depends_on"),
        ("  - {slug: Bad_Slug, name: X, topic: backend}\n", "kebab-case"),
        ("  - {slug: a, name: A, topic: cooking}\n", "topic"),
        (TWO + "  - {slug: replication, name: Again, topic: backend}\n", "twice"),
        (
            "  - {slug: a, name: A, topic: backend, related: [missing]}\n",
            "unknown concept",
        ),
        ("  - {slug: a, name: A, topic: backend, prerequisites: [a]}\n", "itself"),
        ("  - {slug: a, name: " + "x" * 201 + ", topic: backend}\n", "name"),
        (
            "  - {slug: a, name: A, topic: backend, description: " + "x" * 501 + "}\n",
            "description",
        ),
    ],
)
def test_bad_seed_files_are_refused_with_the_reason(body: str, message: str) -> None:
    with pytest.raises(ConceptSeedError, match=message):
        parse_concepts(seed(body), "c.yaml")


def test_a_prerequisite_cycle_is_refused() -> None:
    body = """
  - {slug: a, name: A, topic: backend, prerequisites: [c]}
  - {slug: b, name: B, topic: backend, prerequisites: [a]}
  - {slug: c, name: C, topic: backend, prerequisites: [b]}
"""
    with pytest.raises(ConceptCycleError, match=r"cycle.*a"):
        parse_concepts(seed(body), "c.yaml")


def test_related_edges_may_go_both_ways() -> None:
    body = """
  - {slug: a, name: A, topic: backend, related: [b]}
  - {slug: b, name: B, topic: backend, related: [a]}
"""
    assert len(parse_concepts(seed(body), "c.yaml").edges) == 2


def test_merged_into_implies_retired_and_must_name_a_live_concept() -> None:
    body = """
  - {slug: old, name: Old, topic: backend, merged_into: new}
  - {slug: new, name: New, topic: backend}
"""
    old = parse_concepts(seed(body), "c.yaml").concepts[0]
    assert (old.retired, old.merged_into) == (True, "new")
    gone = "  - {slug: old, name: Old, topic: backend, merged_into: nowhere}\n"
    with pytest.raises(ConceptSeedError, match="unknown concept"):
        parse_concepts(seed(gone), "c.yaml")


def test_the_repo_seed_file_is_valid() -> None:
    # Whatever the owner puts in it, the repo's file must load.
    parse_concepts(SEED.read_text(encoding="utf-8"), str(SEED))


def test_aliases_are_read_trimmed_and_checked() -> None:
    # Abbreviations and other spellings, for the tagging shortlist (2026-10-27).
    graph = parse_concepts(
        seed(
            "  - {slug: write-ahead-log, name: Write-ahead log, topic: databases, "
            "aliases: [' WAL ', write ahead log]}\n"
        ),
        "c.yaml",
    )
    assert graph.concepts[0].aliases == ("WAL", "write ahead log")
    assert parse_concepts(seed(TWO), "c.yaml").concepts[0].aliases == ()
    for bad in ("aliases: WAL", "aliases: ['']", "aliases: [1]"):
        with pytest.raises(ConceptSeedError, match="aliases"):
            parse_concepts(
                seed(f"  - {{slug: wal, name: WAL, topic: databases, {bad}}}\n"),
                "c.yaml",
            )


def test_a_repeated_alias_or_one_equal_to_the_name_is_refused() -> None:
    for bad in ("aliases: [WAL, wal]", "aliases: [Write-ahead log]"):
        with pytest.raises(ConceptSeedError, match="alias"):
            parse_concepts(
                seed(
                    "  - {slug: write-ahead-log, name: Write-ahead log, "
                    f"topic: databases, {bad}}}\n"
                ),
                "c.yaml",
            )
