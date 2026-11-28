"""Turning a decision model's stored probabilities into tags (tagging v3,
2026-10-27). Pure and cheap, so the cut-offs can be retuned on stored answers without
asking again."""

from interval_jobs.ports import ItemDecisions
from interval_jobs.tagging_rollup import Cutoffs, rollup

KNOWN = {"wal", "mvcc", "raft", "caching", "paxos", "quorum"}
CUT = Cutoffs(session=0.5, strong=0.9, title=0.6)


def test_a_session_keeps_concepts_at_or_over_the_cut_at_most_five() -> None:
    got = rollup(
        ItemDecisions(
            {1: (0.4, {"wal": 0.95, "mvcc": 0.5, "raft": 0.49, "nope": 0.99})}, {}
        ),
        KNOWN,
        CUT,
    )
    assert got.sessions[1].concepts == frozenset({"wal", "mvcc"})
    assert got.sessions[1].difficulty == "beginner"  # 0.4 rounds to 0


def test_nothing_over_the_cuts_means_no_tags() -> None:
    # A random sample of the feed: 20 of 30 sections teach none of the graph's
    # concepts, and a forced "most likely" tag on each was most of the false positives.
    got = rollup(
        ItemDecisions({1: (1.0, {"wal": 0.3, "raft": 0.2})}, {"wal": 0.4}), KNOWN, CUT
    )
    assert got.sessions[1].concepts == frozenset()
    assert got.item.concepts == frozenset()


def test_the_article_takes_concepts_in_two_sessions_or_strong_or_from_its_title() -> (
    None
):
    decisions = ItemDecisions(
        {
            1: (0.6, {"wal": 0.6, "raft": 0.95, "caching": 0.55}),
            2: (1.4, {"wal": 0.7, "paxos": 0.6}),
            3: (2.0, {"quorum": 0.3}),
        },
        {"mvcc": 0.65, "caching": 0.3},
        1.0,
    )
    got = rollup(decisions, KNOWN, CUT)
    # wal: two sessions; raft: strong in one; mvcc: the title pass. caching and paxos:
    # one session each, not strong; quorum: under every cut.
    assert got.item.concepts == frozenset({"wal", "raft", "mvcc"})
    assert got.item.difficulty == "intermediate"  # the median of 0.6, 1.4, 2.0 is 1.4


def test_an_article_is_tagged_from_its_own_pass() -> None:
    got = rollup(ItemDecisions({}, {"caching": 0.8, "wal": 0.2}, 2.0), KNOWN, CUT)
    assert got.sessions == {}
    assert got.item.concepts == frozenset({"caching"})
    assert got.item.difficulty == "advanced"


def test_strong_means_strong_in_a_session_not_the_title_pass() -> None:
    decisions = ItemDecisions(
        {1: (1.0, {"wal": 0.55, "raft": 0.92})}, {"wal": 0.95}, 1.0
    )
    got = rollup(decisions, KNOWN, Cutoffs(session=0.5, strong=0.9, title=0.99))
    # raft: strong in a session. wal: 0.95 only in the title pass (under its cut), so
    # not "strong".
    assert got.item.concepts == frozenset({"raft"})
