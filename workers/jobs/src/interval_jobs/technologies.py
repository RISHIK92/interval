"""The curated technology table (PER-4, §5H, P2-W12-S03): the seed file, parsed and
checked against the concept graph. A package name ending in `*` is a prefix (an npm
scope, a Go module path whose /vN suffix varies)."""

import re
from dataclasses import dataclass
from typing import cast, get_args

import yaml

from interval_db.generated import DependencyEcosystem
from interval_jobs.github.manifests import pypi_name

ECOSYSTEMS: tuple[str, ...] = get_args(DependencyEcosystem.__value__)
MAX_CONCEPTS = 4
_SLUG = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


class TechnologySeedError(ValueError):
    pass


@dataclass(frozen=True)
class Package:
    ecosystem: str
    pattern: str  # without the `*`
    prefix: bool


@dataclass(frozen=True)
class TechnologySeed:
    slug: str
    name: str
    packages: tuple[Package, ...]
    concepts: tuple[str, ...]


def parse_technologies(
    text: str, known_concepts: frozenset[str], where: str
) -> tuple[int, list[TechnologySeed]]:
    """The seed's version and technologies; TechnologySeedError names what's wrong."""
    data: object = yaml.safe_load(text)
    if not isinstance(data, dict):
        raise TechnologySeedError(f"{where}: the seed must be a mapping")
    seed = cast(dict[str, object], data)
    version = seed.get("version")
    entries = seed.get("technologies")
    if not isinstance(version, int) or not isinstance(entries, list):
        raise TechnologySeedError(f"{where}: needs `version` and `technologies`")
    out: list[TechnologySeed] = []
    slugs: set[str] = set()
    patterns: dict[tuple[str, str, bool], str] = {}
    for raw in cast(list[object], entries):
        tech = _technology(raw, known_concepts, where)
        if tech.slug in slugs:
            raise TechnologySeedError(f"{where}: {tech.slug} appears twice")
        slugs.add(tech.slug)
        for package in tech.packages:
            key = (package.ecosystem, package.pattern, package.prefix)
            if key in patterns:
                raise TechnologySeedError(
                    f"{where}: {package.ecosystem} package {package.pattern} is in "
                    f"both {patterns[key]} and {tech.slug}"
                )
            patterns[key] = tech.slug
        out.append(tech)
    return version, out


def _technology(raw: object, known: frozenset[str], where: str) -> TechnologySeed:
    if not isinstance(raw, dict):
        raise TechnologySeedError(f"{where}: each technology must be a mapping")
    entry = cast(dict[str, object], raw)
    slug, name = entry.get("slug"), entry.get("name")
    if not isinstance(slug, str) or not _SLUG.match(slug):
        raise TechnologySeedError(f"{where}: bad slug {slug!r}")
    if not isinstance(name, str) or not 1 <= len(name) <= 100:
        raise TechnologySeedError(f"{where}: {slug} needs a name")
    concepts = entry.get("concepts")
    names = (
        [str(c) for c in cast(list[object], concepts)]
        if isinstance(concepts, list)
        else []
    )
    if not 1 <= len(names) <= MAX_CONCEPTS:
        raise TechnologySeedError(f"{where}: {slug} needs 1-{MAX_CONCEPTS} concepts")
    for concept in names:
        if concept not in known:
            raise TechnologySeedError(
                f"{where}: {slug} names unknown concept {concept}"
            )
    return TechnologySeed(slug, name, _packages(entry, slug, where), tuple(names))


def _packages(entry: dict[str, object], slug: str, where: str) -> tuple[Package, ...]:
    raw = entry.get("packages")
    if not isinstance(raw, dict) or not raw:
        raise TechnologySeedError(f"{where}: {slug} has no packages")
    out: list[Package] = []
    for ecosystem, names in cast(dict[str, object], raw).items():
        if ecosystem not in ECOSYSTEMS:
            raise TechnologySeedError(f"{where}: {slug} names ecosystem {ecosystem}")
        if not isinstance(names, list) or not names:
            raise TechnologySeedError(f"{where}: {slug} lists no {ecosystem} packages")
        for name in cast(list[object], names):
            raw_pattern = str(name)
            prefix = raw_pattern.endswith("*")
            pattern = raw_pattern.removesuffix("*")
            if not 1 <= len(pattern) <= 214 or "*" in pattern:
                raise TechnologySeedError(
                    f"{where}: {slug} has a bad {ecosystem} package {raw_pattern!r} "
                    "(a `*` only at the end)"
                )
            # Stored PyPI names are normalised (PEP 503); so are the seed's.
            if ecosystem == "pypi":
                pattern = pypi_name(pattern)
            out.append(Package(ecosystem, pattern, prefix))
    return tuple(out)
