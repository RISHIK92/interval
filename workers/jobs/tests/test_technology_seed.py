"""The technology seed, parsed and checked against the concept graph (PER-4, §5H,
P2-W12-S03)."""

from pathlib import Path

import pytest

from interval_jobs.concepts.graph import parse_concepts
from interval_jobs.technologies import (
    Package,
    TechnologySeedError,
    parse_technologies,
)

SEEDS = Path(__file__).resolve().parents[1] / "seeds"
KNOWN = frozenset({"connection-pooling", "mvcc", "indexes", "background-jobs"})

GOOD = """
version: 2
technologies:
  - slug: postgresql
    name: PostgreSQL
    packages: { npm: [pg], go: ["github.com/jackc/pgx*"] }
    concepts: [mvcc, indexes]
  - slug: bullmq
    name: BullMQ
    packages: { npm: [bullmq], pypi: [bullmq] }
    concepts: [background-jobs]
"""


def test_a_seed_parses_with_exact_and_prefix_packages() -> None:
    version, techs = parse_technologies(GOOD, KNOWN, "t.yaml")
    assert version == 2
    pg, bull = techs
    assert (pg.slug, pg.name, pg.concepts) == (
        "postgresql",
        "PostgreSQL",
        ("mvcc", "indexes"),
    )
    assert pg.packages == (
        Package("npm", "pg", prefix=False),
        Package("go", "github.com/jackc/pgx", prefix=True),
    )
    assert bull.packages == (
        Package("npm", "bullmq", False),
        Package("pypi", "bullmq", False),
    )


@pytest.mark.parametrize(
    ("text", "complaint"),
    [
        (GOOD.replace("[mvcc, indexes]", "[mvcc, nope]"), "unknown concept nope"),
        (GOOD.replace("slug: bullmq", "slug: postgresql"), "twice"),
        (GOOD.replace("npm: [bullmq]", "npm: [pg]"), "npm package pg"),
        (GOOD.replace("concepts: [background-jobs]", "concepts: []"), "1-4 concepts"),
        (GOOD.replace("{ npm: [bullmq], pypi: [bullmq] }", "{}"), "no packages"),
        (GOOD.replace("npm: [pg]", "cargo: [pg]"), "ecosystem cargo"),
        (GOOD.replace("slug: bullmq", "slug: Bull MQ"), "slug"),
        (GOOD.replace("npm: [pg]", 'npm: ["*"]'), "a `\\*` only at the end"),
        (GOOD.replace("npm: [pg]", 'npm: ["p*g"]'), "a `\\*` only at the end"),
        ("[]", "a mapping"),
    ],
)
def test_a_bad_seed_is_refused_with_its_reason(text: str, complaint: str) -> None:
    with pytest.raises(TechnologySeedError, match=complaint):
        parse_technologies(text, KNOWN, "t.yaml")


def test_pypi_names_are_normalised_as_stored_dependencies_are() -> None:
    text = GOOD.replace("pypi: [bullmq]", "pypi: [Unleash_Client]")
    _, (_, bull) = parse_technologies(text, KNOWN, "t.yaml")
    assert Package("pypi", "unleash-client", False) in bull.packages


def test_the_drafted_seed_only_names_concepts_that_exist() -> None:
    graph = parse_concepts(
        (SEEDS / "concepts.yaml").read_text(encoding="utf-8"), "concepts.yaml"
    )
    known = frozenset(c.slug for c in graph.concepts if not c.retired)
    _, techs = parse_technologies(
        (SEEDS / "technologies.yaml").read_text(encoding="utf-8"),
        known,
        "technologies.yaml",
    )
    assert len(techs) >= 50
