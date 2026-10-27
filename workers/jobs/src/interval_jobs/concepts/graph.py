"""The concept seed file, parsed and validated (DB-2, §3.1, Q-P1-03, Q-P1-04).

Edges come from each concept's lists: `prerequisites: [a]` on b is "a prerequisite of
b"; `related: [c]` and `applied_in: [d]` point from the concept. "Prerequisite of" must
stay acyclic; the database checks that again behind this.
"""

import re
from typing import Literal, cast

import yaml

from interval_db.generated import ConceptEdgeType
from interval_jobs.ports import (
    ConceptCycleError,
    ConceptEdge,
    ConceptGraph,
    ConceptSeed,
)

MAX_NAME = 200
MAX_DESCRIPTION = 500
TOPICS = frozenset({"system-design", "databases", "distributed-systems", "backend"})
_SLUG = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
_KEYS = frozenset(
    {
        "slug",
        "name",
        "topic",
        "description",
        "prerequisites",
        "related",
        "applied_in",
        "retired",
        "merged_into",
        "aliases",
    }
)
_EDGE_LISTS: dict[str, tuple[ConceptEdgeType, Literal["in", "out"]]] = {
    "prerequisites": ("prerequisite_of", "in"),
    "related": ("related_to", "out"),
    "applied_in": ("applied_in", "out"),
}


class ConceptSeedError(ValueError):
    pass


def _text(fields: dict[str, object], key: str, where: str) -> str | None:
    value = fields.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ConceptSeedError(f"{where}: {key} must be non-empty text")
    return value.strip()


def _required(fields: dict[str, object], key: str, where: str) -> str:
    value = _text(fields, key, where)
    if value is None:
        raise ConceptSeedError(f"{where}: {key} is required")
    return value


def _slugs(fields: dict[str, object], key: str, where: str) -> list[str]:
    value = fields.get(key, [])
    if not isinstance(value, list):
        raise ConceptSeedError(f"{where}: {key} must be a list of slugs")
    items = cast(list[object], value)
    if not all(isinstance(v, str) for v in items):
        raise ConceptSeedError(f"{where}: {key} must be a list of slugs")
    return [str(v) for v in items]


_MAX_ALIAS = 100


def _aliases(fields: dict[str, object], name: str, where: str) -> tuple[str, ...]:
    value = fields.get("aliases", [])
    if not isinstance(value, list):
        raise ConceptSeedError(f"{where}: aliases must be a list of text")
    items = cast(list[object], value)
    if not all(isinstance(v, str) and v.strip() for v in items):
        raise ConceptSeedError(f"{where}: aliases must be a list of non-empty text")
    aliases = tuple(str(v).strip() for v in items)
    if any(len(a) > _MAX_ALIAS for a in aliases):
        raise ConceptSeedError(f"{where}: aliases are at most {_MAX_ALIAS} characters")
    folded = [a.casefold() for a in (name, *aliases)]
    if len(set(folded)) != len(folded):
        raise ConceptSeedError(f"{where}: an alias repeats the name or another alias")
    return aliases


def _concept(
    raw: object, where: str
) -> tuple[ConceptSeed, list[tuple[str, ConceptEdge]]]:
    if not isinstance(raw, dict):
        raise ConceptSeedError(f"{where}: expected a mapping")
    fields = {str(k): v for k, v in cast(dict[object, object], raw).items()}
    unknown = sorted(set(fields) - _KEYS)
    if unknown:
        raise ConceptSeedError(f"{where}: unknown field {', '.join(unknown)}")
    slug = _required(fields, "slug", where)
    where = where.rsplit(":", 1)[0] + f": {slug}"
    if not _SLUG.match(slug):
        raise ConceptSeedError(f"{where}: slug must be kebab-case")
    topic = _required(fields, "topic", where)
    if topic not in TOPICS:
        raise ConceptSeedError(
            f"{where}: topic must be one of {', '.join(sorted(TOPICS))}"
        )
    retired = fields.get("retired", False)
    if not isinstance(retired, bool):
        raise ConceptSeedError(f"{where}: retired must be true or false")
    merged_into = _text(fields, "merged_into", where)
    name = _required(fields, "name", where)
    description = _text(fields, "description", where)
    # The concept table's limits, checked here so the owner gets a clear message.
    if len(name) > MAX_NAME:
        raise ConceptSeedError(f"{where}: name is longer than {MAX_NAME} characters")
    if description is not None and len(description) > MAX_DESCRIPTION:
        raise ConceptSeedError(
            f"{where}: description is longer than {MAX_DESCRIPTION} characters"
        )
    concept = ConceptSeed(
        slug=slug,
        name=name,
        topic=topic,
        description=description,
        retired=retired or merged_into is not None,
        merged_into=merged_into,
        aliases=_aliases(fields, name, where),
    )
    edges: list[tuple[str, ConceptEdge]] = []
    for key, (edge_type, direction) in _EDGE_LISTS.items():
        for other in _slugs(fields, key, where):
            if other == slug:
                raise ConceptSeedError(f"{where}: {key} names the concept itself")
            pair = (other, slug) if direction == "in" else (slug, other)
            edges.append((where, (*pair, edge_type)))
    return concept, edges


def parse_concepts(text: str, path: str) -> ConceptGraph:
    try:
        loaded: object = yaml.safe_load(text)
    except yaml.YAMLError as error:
        raise ConceptSeedError(f"{path}: {error}") from error
    if not isinstance(loaded, dict):
        raise ConceptSeedError(f"{path}: expected `version` and `concepts`")
    doc = cast(dict[object, object], loaded)
    version, entries = doc.get("version"), doc.get("concepts")
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        raise ConceptSeedError(f"{path}: version must be a positive integer")
    if not isinstance(entries, list):
        raise ConceptSeedError(f"{path}: concepts must be a list")

    concepts: list[ConceptSeed] = []
    wanted: list[tuple[str, ConceptEdge]] = []
    for index, raw in enumerate(cast(list[object], entries)):
        concept, found = _concept(raw, f"{path}: concept {index + 1}")
        concepts.append(concept)
        wanted.extend(found)

    known: dict[str, ConceptSeed] = {}
    for concept in concepts:
        if concept.slug in known:
            raise ConceptSeedError(f"{path}: {concept.slug} is listed twice")
        known[concept.slug] = concept
    for concept in concepts:
        target = concept.merged_into
        if target is None:
            continue
        if target not in known:
            raise ConceptSeedError(f"{path}: {concept.slug}: unknown concept {target}")
        if known[target].retired:
            raise ConceptSeedError(
                f"{path}: {concept.slug}: merged into retired concept {target}"
            )
    edges: set[ConceptEdge] = set()
    for where, edge in wanted:
        missing = next((s for s in edge[:2] if s not in known), None)
        if missing is not None:
            raise ConceptSeedError(f"{where}: unknown concept {missing}")
        edges.add(edge)
    refuse_cycles(path, edges)
    return ConceptGraph(version, concepts, edges)


def refuse_cycles(path: str, edges: set[ConceptEdge]) -> None:
    after: dict[str, list[str]] = {}
    for source, target, edge_type in edges:
        if edge_type == "prerequisite_of":
            after.setdefault(source, []).append(target)
    done: set[str] = set()

    def visit(slug: str, trail: list[str]) -> None:
        for nxt in sorted(after.get(slug, [])):
            if nxt in trail:
                loop = [*trail[trail.index(nxt) :], slug, nxt]
                raise ConceptCycleError(
                    f"{path}: prerequisite cycle: {' -> '.join(loop)}"
                )
            if nxt not in done:
                visit(nxt, [*trail, slug])
        done.add(slug)

    for slug in sorted(after):
        if slug not in done:
            visit(slug, [])
