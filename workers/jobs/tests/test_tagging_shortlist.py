"""The tagging shortlist (2026-10-27): before a decision model is asked, each moment
gets 15-25 candidate concepts from its embedding, alias and name hits in its text, and
the article's title-and-summary embedding. A concept left out can never be tagged."""

from interval_jobs.concepts.graph import parse_concepts
from interval_jobs.tagging_shortlist import alias_hits, recall, shortlist

GRAPH = parse_concepts(
    """version: 1
concepts:
  - {slug: write-ahead-log, name: Write-ahead log, topic: databases, aliases: [WAL]}
  - {slug: raft, name: Raft, topic: distributed-systems}
  - {slug: paxos, name: Paxos, topic: distributed-systems}
  - {slug: caching, name: Caching, topic: backend}
  - {slug: old, name: Old idea, topic: backend, retired: true}
""",
    "c.yaml",
)


# Unit vectors along one axis each: cosine similarity is easy to read off.
def axis(i: int) -> list[float]:
    return [1.0 if j == i else 0.0 for j in range(5)]


VECTORS = {
    "write-ahead-log": axis(0),
    "raft": axis(1),
    "paxos": axis(2),
    "caching": axis(3),
    "old": axis(4),
}


def test_names_and_aliases_match_whole_words_whatever_the_case() -> None:
    text = "Postgres writes the wal first. Raft-style logs; the WALL is unrelated."
    assert alias_hits(text, GRAPH) == ["write-ahead-log", "raft"]
    assert alias_hits("A WALLET of old ideas", GRAPH) == []  # retired, and no word


def test_the_shortlist_puts_text_hits_first_then_the_prior_then_similarity() -> None:
    section = [0.1, 0.0, 0.9, 0.5, 0.0]  # nearest paxos, then caching
    prior = axis(1)  # the article is about raft
    got = shortlist(
        section, prior, "Readers check the WAL.", VECTORS, GRAPH, size=4, prior_size=1
    )
    assert got == ["write-ahead-log", "raft", "paxos", "caching"]


def test_the_shortlist_is_capped_and_never_offers_a_retired_concept() -> None:
    got = shortlist([0, 0, 0, 0, 1.0], None, "", VECTORS, GRAPH, size=2, prior_size=0)
    assert "old" not in got and len(got) == 2


def test_recall_is_the_share_of_labelled_concepts_the_shortlists_kept() -> None:
    assert recall([({"a", "b"}, ["a", "x"]), ({"c"}, ["c"])]) == 2 / 3
    assert recall([]) == 0.0


def test_many_text_hits_keep_the_nearest_not_the_first_in_the_file() -> None:
    # Every concept named in the text: the cap keeps the ones nearest the moment.
    text = "WAL, Raft, Paxos and caching all appear here."
    got = shortlist(
        [0, 0, 0.2, 1.0, 0], None, text, VECTORS, GRAPH, size=2, prior_size=0
    )
    assert got == ["caching", "paxos"]


def test_the_prior_adds_new_candidates_after_text_hits() -> None:
    # The prior's top concept is already a text hit: it brings the next one instead.
    prior = [0.9, 0.5, 0, 0, 0]
    got = shortlist(
        [0, 0, 0, 1.0, 0], prior, "the WAL", VECTORS, GRAPH, size=3, prior_size=1
    )
    assert got == ["write-ahead-log", "raft", "caching"]


def test_a_hyphenated_form_matches_on_either_side() -> None:
    assert alias_hits("a multi-raft group and Raft-style logs", GRAPH) == ["raft"]
