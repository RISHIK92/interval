"""Topic path proposals (§5F, Q-P2-22, Q-P2-24, P2-W10-S01): the prompts, the strict
reading of the model's replies, and the choice of each section's sessions. Pure: the
proposer calls the model through the gateway and saves what this accepts as drafts
for the owner to review.

The model proposes; the rules are checked, not trusted: a candidate's concepts must be
known and have something to read, and an order must put every prerequisite in an
earlier section (or the same one). Only edges between the path's own concepts are
checked (a prerequisite through a concept outside the path isn't); the graph itself
refuses prerequisite cycles (Q-P1-04)."""

import json
import re
from collections.abc import Collection, Iterable

from pydantic import BaseModel, ValidationError

from interval_jobs.ports import (
    ConceptCoverage,
    DraftSection,
    Message,
    PathCandidate,
    PathDraft,
    SessionCandidate,
)

# Bump to propose afresh with a changed prompt.
PROMPT_VERSION = 1
MIN_CONCEPTS = 3
MAX_CONCEPTS = 12
MIN_SESSIONS = 2  # owner, 2026-10-28 (Q-P2-22): 2 to 4 readings a section
MAX_SESSIONS = 4
MIN_SECTIONS = 2
# As the path table's checks (a longer reply would fail its insert).
MAX_NAME = 120
MAX_WHY = 500


class PathReplyError(ValueError):
    """The model's reply breaks a rule."""


def _edges_text(edges: Iterable[tuple[str, str]], within: Collection[str]) -> str:
    lines = sorted(f"{a} -> {b}" for a, b in edges if a in within and b in within)
    return "\n".join(lines) or "(none)"


def candidates_prompt(
    coverage: list[ConceptCoverage], edges: set[tuple[str, str]], count: int
) -> list[Message]:
    covered = [c for c in coverage if c.moments > 0]
    slugs = {c.slug for c in covered}
    concepts = "\n".join(
        f"- {c.slug} ({c.name}, {c.topic}): {c.moments} readings from "
        f"{c.sources} sources"
        for c in sorted(covered, key=lambda c: (c.topic, c.slug))
    )
    return [
        {
            "role": "system",
            "content": (
                "You design learning paths for software engineers: each path is a "
                f"coherent topic of {MIN_CONCEPTS} to {MAX_CONCEPTS} concepts a person "
                "would study together, from foundations to applications. Use only "
                "the concept slugs given. Prefer concepts with more readings. "
                'Reply with JSON only: {"paths": [{"name": "...", "why": "one '
                'sentence on who it is for and what they get", "concepts": '
                '["slug", ...]}]}'
            ),
        },
        {
            "role": "user",
            "content": (
                f"Propose {count} paths.\n\nConcepts:\n{concepts}\n\n"
                "Prerequisites (a -> b: learn a before b):\n"
                f"{_edges_text(edges, slugs)}"
            ),
        },
    ]


class _Candidate(BaseModel):
    name: str
    why: str
    concepts: list[str]


class _Candidates(BaseModel):
    paths: list[_Candidate]


class _Order(BaseModel):
    sections: list[list[str]]


def _json(reply: str) -> str:
    return re.sub(r"^```(?:json)?\s*|\s*```$", "", reply.strip())


def parse_candidates(
    reply: str, coverage: list[ConceptCoverage]
) -> tuple[list[PathCandidate], list[tuple[str, str]]]:
    """The valid candidates, and each refused one's name with why."""
    try:
        parsed = _Candidates.model_validate(json.loads(_json(reply)))
    except (json.JSONDecodeError, ValidationError) as error:
        raise PathReplyError(f"not the JSON asked for: {error}") from error
    readable = {c.slug for c in coverage if c.moments > 0}
    known = {c.slug for c in coverage}
    kept: list[PathCandidate] = []
    refused: list[tuple[str, str]] = []
    names: set[str] = set()
    for c in parsed.paths:
        name, why = c.name.strip(), c.why.strip()
        concepts = tuple(dict.fromkeys(slug.strip() for slug in c.concepts))
        unknown = [s for s in concepts if s not in known]
        unread = [s for s in concepts if s in known and s not in readable]
        if not name or not why:
            refused.append((name or "(unnamed)", "a name and a why are needed"))
        elif len(name) > MAX_NAME:
            refused.append((name, f"name over {MAX_NAME} characters"))
        elif len(why) > MAX_WHY:
            refused.append((name, f"why over {MAX_WHY} characters"))
        elif name.lower() in names:
            refused.append((name, "a path by that name was already proposed"))
        elif unknown:
            refused.append((name, f"unknown concepts: {', '.join(unknown)}"))
        elif unread:
            refused.append((name, f"nothing to read on: {', '.join(unread)}"))
        elif not MIN_CONCEPTS <= len(concepts) <= MAX_CONCEPTS:
            refused.append(
                (name, f"{len(concepts)} concepts, not {MIN_CONCEPTS}-{MAX_CONCEPTS}")
            )
        else:
            names.add(name.lower())
            kept.append(PathCandidate(name, why, concepts))
    return kept, refused


def order_prompt(
    candidate: PathCandidate, edges: set[tuple[str, str]]
) -> list[Message]:
    return [
        {
            "role": "system",
            "content": (
                "You order a learning path's concepts into sections, foundations "
                "first. A section is one concept, or two or three that belong "
                "together. Every concept appears in exactly one section, and every "
                "prerequisite comes in an earlier section or the same one. "
                'Reply with JSON only: {"sections": [["slug", ...], ...]}'
            ),
        },
        {
            "role": "user",
            "content": (
                f"Path: {candidate.name}\nConcepts: {', '.join(candidate.concepts)}\n\n"
                "Prerequisites (a -> b: learn a before b):\n"
                f"{_edges_text(edges, candidate.concepts)}"
            ),
        },
    ]


def parse_order(
    reply: str, candidate: PathCandidate, edges: set[tuple[str, str]]
) -> list[tuple[str, ...]]:
    """The sections, or PathReplyError naming the first broken rule."""
    try:
        parsed = _Order.model_validate(json.loads(_json(reply)))
    except (json.JSONDecodeError, ValidationError) as error:
        raise PathReplyError(f"not the JSON asked for: {error}") from error
    sections = [tuple(slug.strip() for slug in s) for s in parsed.sections]
    wanted = set(candidate.concepts)
    where: dict[str, int] = {}
    for i, section in enumerate(sections):
        if not section:
            raise PathReplyError(f"section {i + 1} is empty")
        for slug in section:
            if slug not in wanted:
                raise PathReplyError(f"{slug} is not in the path")
            if slug in where:
                raise PathReplyError(f"{slug} appears twice")
            where[slug] = i
    missing = sorted(wanted - where.keys())
    if missing:
        raise PathReplyError(f"missing {', '.join(missing)}")
    for a, b in sorted(edges):
        if a in where and b in where and where[a] > where[b]:
            raise PathReplyError(f"{a} comes after {b}, which needs it")
    return sections


def _rank(c: SessionCandidate) -> tuple[bool, bool, int]:
    # Live questions first (the checkpoint asks them), then frameable (it opens in the
    # reader), then the newest.
    return (not c.live_questions, not c.frameable, -c.moment_id)


def pick_sessions(concepts: tuple[str, ...], pool: list[SessionCandidate]) -> list[int]:
    """Up to MAX_SESSIONS moments on these concepts: one per source first, best
    first; a source repeats only when there aren't enough others."""
    on = sorted((c for c in pool if c.concepts & set(concepts)), key=_rank)
    first: list[SessionCandidate] = []
    rest: list[SessionCandidate] = []
    seen: set[int] = set()
    for c in on:
        (rest if c.source_id in seen else first).append(c)
        seen.add(c.source_id)
    return [c.moment_id for c in (first + rest)[:MAX_SESSIONS]]


def draft_path(
    candidate: PathCandidate,
    sections: list[tuple[str, ...]],
    pool: list[SessionCandidate],
) -> PathDraft | None:
    """The draft, its sections under MIN_SESSIONS readings dropped; None under
    MIN_SECTIONS sections."""
    kept = tuple(
        DraftSection(section, tuple(moments))
        for section in sections
        if len(moments := pick_sessions(section, pool)) >= MIN_SESSIONS
    )
    if len(kept) < MIN_SECTIONS:
        return None
    return PathDraft(candidate.name, candidate.why, kept)
