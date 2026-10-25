"""Loading the concept seed file into the store (DB-2, Q-P1-03, Q-P1-04).

The file is the owner's: a concept dropped from it is retired, never deleted, so tags
and learner state that reference it still resolve. Every change must come with a higher
`version` (the graph_version Q-P1-04 asks for); loading an unchanged file is a no-op.
"""

from dataclasses import dataclass, replace

from interval_jobs.concepts.graph import ConceptSeedError
from interval_jobs.ports import ConceptGraph, ConceptSeed, Store


@dataclass(frozen=True)
class ConceptSync:
    changed: bool
    added: int
    updated: int
    retired: int  # newly retired, by the file or by being dropped from it


def _target(current: ConceptGraph | None, graph: ConceptGraph) -> ConceptGraph:
    listed = {c.slug for c in graph.concepts}
    dropped = [
        replace(c, retired=True)
        for c in (current.concepts if current else [])
        if c.slug not in listed
    ]
    return ConceptGraph(graph.version, [*graph.concepts, *dropped], graph.edges)


def sync_concepts(store: Store, graph: ConceptGraph) -> ConceptSync:
    current = store.concepts.state()
    target = _target(current, graph)
    before: dict[str, ConceptSeed] = (
        {c.slug: c for c in current.concepts} if current else {}
    )
    same = (
        current is not None
        and set(current.concepts) == set(target.concepts)
        and current.edges == target.edges
    )
    if same:
        return ConceptSync(changed=False, added=0, updated=0, retired=0)
    if current is not None and graph.version <= current.version:
        raise ConceptSeedError(
            f"the concept file changed but its version ({graph.version}) is not "
            f"above the loaded one ({current.version}): bump it"
        )
    store.concepts.apply(target)
    added = sum(1 for c in target.concepts if c.slug not in before)
    updated = sum(
        1 for c in target.concepts if c.slug in before and before[c.slug] != c
    )
    retired = sum(
        1
        for c in target.concepts
        if c.retired and not (c.slug in before and before[c.slug].retired)
    )
    return ConceptSync(changed=True, added=added, updated=updated, retired=retired)
