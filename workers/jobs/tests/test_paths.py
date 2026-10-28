"""Topic path proposals (§5F, Q-P2-22, Q-P2-24, P2-W10-S01): the prompts, the strict
reading of the model's replies, and the deterministic choice of sessions. Pure."""

import json

import pytest

from interval_jobs.paths import (
    PathReplyError,
    candidates_prompt,
    draft_path,
    order_prompt,
    parse_candidates,
    parse_order,
    pick_sessions,
)
from interval_jobs.ports import ConceptCoverage, PathCandidate, SessionCandidate

COVERAGE = [
    ConceptCoverage("tcp", "TCP", "backend", 4, 3),
    ConceptCoverage("http", "HTTP", "backend", 6, 4),
    ConceptCoverage("tls", "TLS", "backend", 2, 2),
    ConceptCoverage("cdn", "CDNs", "system-design", 3, 2),
    ConceptCoverage("dns", "DNS", "backend", 0, 0),  # nothing to read
]
# a prerequisite of b
EDGES = {("tcp", "http"), ("tcp", "tls"), ("http", "cdn")}


def test_the_candidates_prompt_lists_covered_concepts_and_prerequisites() -> None:
    content = " ".join(m["content"] for m in candidates_prompt(COVERAGE, EDGES, 10))
    assert "tcp" in content and "TCP" in content and "4 readings" in content
    assert "dns" not in content  # nothing to read: never offered
    assert "tcp -> http" in content
    assert "10" in content and "JSON" in content


def test_candidates_are_kept_or_refused_with_a_reason() -> None:
    reply = json.dumps(
        {
            "paths": [
                {
                    "name": "The web stack",
                    "why": "From packets to pages.",
                    "concepts": ["tcp", "http", "tls", "cdn"],
                },
                {"name": "Too short", "why": "x", "concepts": ["tcp", "http"]},
                {"name": "Unknown", "why": "x", "concepts": ["tcp", "http", "quic"]},
                {"name": "Unread", "why": "x", "concepts": ["tcp", "http", "dns"]},
                {
                    "name": "The web stack",
                    "why": "again",
                    "concepts": ["tcp", "http", "tls"],
                },
                {"name": "N" * 121, "why": "x", "concepts": ["tcp", "http", "tls"]},
                {"name": "Wordy", "why": "w" * 501, "concepts": ["tcp", "http", "tls"]},
            ]
        }
    )
    kept, refused = parse_candidates(f"```json\n{reply}\n```", COVERAGE)
    assert kept == [
        PathCandidate(
            "The web stack", "From packets to pages.", ("tcp", "http", "tls", "cdn")
        )
    ]
    assert [name for name, _ in refused] == [
        "Too short",
        "Unknown",
        "Unread",
        "The web stack",
        "N" * 121,
        "Wordy",
    ]
    assert "120" in refused[4][1] and "500" in refused[5][1]
    assert "3" in refused[0][1] and "quic" in refused[1][1] and "dns" in refused[2][1]


def test_a_reply_that_isnt_the_json_asked_for_is_refused() -> None:
    with pytest.raises(PathReplyError, match="JSON"):
        parse_candidates("Here are some paths!", COVERAGE)


WEB = PathCandidate(
    "The web stack", "From packets to pages.", ("tcp", "http", "tls", "cdn")
)


def test_the_order_prompt_carries_the_candidate_and_its_prerequisites() -> None:
    content = " ".join(m["content"] for m in order_prompt(WEB, EDGES))
    assert all(slug in content for slug in WEB.concepts)
    assert "tcp -> http" in content and "JSON" in content


def test_an_order_respecting_prerequisites_is_kept() -> None:
    reply = json.dumps({"sections": [["tcp"], ["http", "tls"], ["cdn"]]})
    assert parse_order(reply, WEB, EDGES) == [("tcp",), ("http", "tls"), ("cdn",)]
    # A prerequisite in the same section is fine too.
    same = json.dumps({"sections": [["tcp", "http"], ["tls"], ["cdn"]]})
    assert parse_order(same, WEB, EDGES)[0] == ("tcp", "http")


@pytest.mark.parametrize(
    ("sections", "why"),
    [
        ([["http"], ["tcp"], ["tls"], ["cdn"]], "tcp comes after http"),
        ([["tcp"], ["http"], ["cdn"]], "missing tls"),
        ([["tcp"], ["http", "tls"], ["cdn", "tcp"]], "twice"),
        ([["tcp"], ["http", "tls"], ["cdn"], ["quic"]], "not in the path"),
        ([["tcp"], [], ["http", "tls", "cdn"]], "empty"),
    ],
)
def test_an_order_breaking_a_rule_is_refused(
    sections: list[list[str]], why: str
) -> None:
    with pytest.raises(PathReplyError, match=why):
        parse_order(json.dumps({"sections": sections}), WEB, EDGES)


def candidate(
    moment: int, source: int, concepts: set[str], live: bool, frameable: bool
) -> SessionCandidate:
    return SessionCandidate(moment, frozenset(concepts), source, frameable, live)


def test_sessions_spread_sources_and_prefer_moments_with_questions_then_frameable() -> (
    None
):
    pool = [
        candidate(1, 10, {"tcp"}, live=False, frameable=True),
        candidate(2, 10, {"tcp"}, live=True, frameable=True),  # source 10's best
        candidate(3, 11, {"tcp"}, live=True, frameable=False),
        candidate(4, 12, {"tcp"}, live=False, frameable=True),
        candidate(5, 13, {"tcp"}, live=False, frameable=False),
        candidate(6, 14, {"tcp"}, live=False, frameable=False),
        candidate(7, 15, {"http"}, live=True, frameable=True),  # another concept
    ]
    # One per source first, best first; at most 4.
    assert pick_sessions(("tcp",), pool) == [2, 3, 4, 6]
    assert pick_sessions(("dns",), pool) == []


def test_a_source_repeats_only_when_there_arent_enough_others() -> None:
    pool = [
        candidate(1, 10, {"tls"}, live=True, frameable=True),
        candidate(2, 10, {"tls"}, live=False, frameable=True),
        candidate(3, 11, {"tls"}, live=False, frameable=True),
    ]
    assert pick_sessions(("tls",), pool) == [1, 3, 2]


def test_a_path_drops_sections_under_two_readings_and_needs_two_sections() -> None:
    # Owner, 2026-10-28 (Q-P2-22): 2 to 4 readings a section.
    pool = [
        candidate(1, 10, {"tcp"}, live=True, frameable=True),
        candidate(2, 11, {"tcp"}, live=True, frameable=True),
        candidate(3, 12, {"tls"}, live=True, frameable=True),  # only one: dropped
        candidate(4, 13, {"http"}, live=True, frameable=True),
        candidate(5, 14, {"http"}, live=False, frameable=True),
    ]
    sections = [("tcp",), ("tls",), ("http",)]
    draft = draft_path(WEB, sections, pool)
    assert draft is not None
    assert [(s.concepts, s.moment_ids) for s in draft.sections] == [
        (("tcp",), (2, 1)),
        (("http",), (4, 5)),
    ]
    assert draft_path(WEB, [("tcp",), ("tls",)], pool) is None
