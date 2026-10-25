"""Drafting candidate concepts for the owner (Q-P1-03: an LLM drafts, the owner edits
and approves). One call through the gateway (ADR-0008); the answer is validated
against the loaded graph and returned as a YAML file to review. Nothing is loaded:
the owner copies what they approve into the seed file and bumps its version.
"""

import re
from typing import cast

import yaml

from interval_jobs.ai.gateway import AiGateway, OverBudget
from interval_jobs.concepts.graph import TOPICS, ConceptSeedError, parse_concepts
from interval_jobs.ports import ConceptCycleError, ConceptGraph, Message

PROMPT_VERSION = 1
_FENCE = re.compile(r"```(?:yaml)?\s*\n(.*?)\n```", re.S)


class DraftError(ValueError):
    pass


def _messages(graph: ConceptGraph, topic: str, count: int) -> list[Message]:
    known = "\n".join(
        f"- {c.slug} ({c.topic}): {c.name}" for c in graph.concepts if not c.retired
    )
    return [
        {
            "role": "system",
            "content": (
                "You draft concepts for an engineering learning graph. A concept is "
                "one specific technical idea (replication lag, connection pooling), "
                "not a broad area. Answer with a YAML list only."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Propose up to {count} new concepts for the topic {topic}. Each item "
                "has slug (kebab-case), name, topic, description (one line), and "
                "optionally prerequisites, related and applied_in: lists of slugs "
                "that are either below or among your new concepts. Do not repeat "
                f"these existing concepts:\n{known}"
            ),
        },
    ]


def _candidates(answer: str) -> list[object]:
    fenced = _FENCE.search(answer)
    try:
        loaded: object = yaml.safe_load(fenced.group(1) if fenced else answer)
    except yaml.YAMLError as error:
        raise DraftError(f"the model's answer is not YAML: {error}") from error
    if not isinstance(loaded, list):
        raise DraftError("the model's answer is not a YAML list of concepts")
    return cast(list[object], loaded)


def _slug_of(candidate: object) -> str | None:
    # Model output is untrusted: anything but a text slug is left for the parser.
    if isinstance(candidate, dict):
        slug = cast(dict[object, object], candidate).get("slug")
        return slug if isinstance(slug, str) else None
    return None


def draft_concepts(
    gateway: AiGateway, graph: ConceptGraph, topic: str, count: int, model: str
) -> str:
    if topic not in TOPICS:
        raise DraftError(f"topic must be one of {', '.join(sorted(TOPICS))}")
    result = gateway.complete(
        feature="concept_drafting",
        user_id=None,
        model=model,
        messages=_messages(graph, topic, count),
    )
    if isinstance(result, OverBudget):
        raise DraftError(f"the {result.scope} AI budget is spent for today")
    existing = {c.slug for c in graph.concepts}
    fresh: list[object] = [
        c for c in _candidates(result.text) if _slug_of(c) not in existing
    ]
    # Validate the candidates as if added to the graph: links must resolve, no cycles.
    known = [{"slug": c.slug, "name": c.name, "topic": c.topic} for c in graph.concepts]
    merged = yaml.safe_dump({"version": graph.version + 1, "concepts": known + fresh})
    try:
        parse_concepts(merged, "draft")
    except (ConceptSeedError, ConceptCycleError) as error:
        raise DraftError(str(error)) from error
    header = (
        f"# DRAFT concepts for {topic}: {model}, prompt v{PROMPT_VERSION}, "
        f"${result.usage.cost_usd}. Not loaded.\n"
        "# Review, edit, copy what you approve into concepts.yaml, and bump its "
        "version.\n"
    )
    return header + yaml.safe_dump(fresh, sort_keys=False, allow_unicode=True)
