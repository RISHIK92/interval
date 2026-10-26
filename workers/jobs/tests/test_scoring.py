"""Rule-based scoring and re-ranking (REC-2, REC-3, Q-P1-13, P1-W4-S03): each rule moves
the score the expected way, the per-source cap holds, MMR spreads the feed, and every
weight comes from the one config."""

from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from interval_jobs.adapters.memory import RANKING_DEFAULTS
from interval_jobs.ports import EntryFacts
from interval_jobs.ranking.candidates import Candidate
from interval_jobs.ranking.scoring import (
    RankingConfig,
    RankingConfigError,
    Scored,
    UserSignals,
    rerank,
    score,
)

NOW = datetime(2026, 10, 26, 12, tzinfo=UTC)
CONFIG = RankingConfig.from_rows({**RANKING_DEFAULTS, "cap.per_source": 2})
USER = UserSignals(
    topics=frozenset({"distributed-systems"}),
    level="intermediate",
    break_length="3-8",
    less_liked=frozenset(),
    avoided_concepts=frozenset(),
)
BASE = EntryFacts(
    moment_id=1,
    item_id=10,
    source_id=100,
    minutes=5,
    difficulty="intermediate",
    published_at=NOW - timedelta(days=1),
    quality=3,
    concepts=frozenset({"raft"}),
    topics=frozenset({"distributed-systems"}),
    source_name="Example Engineering",
)


def ranked(facts: EntryFacts, user: UserSignals = USER) -> Scored:
    candidate = Candidate(facts.moment_id, facts.item_id, facts.source_id, {"topic"})
    (scored,) = score([candidate], {facts.key: facts}, user, CONFIG, NOW)
    return scored


def one(facts: EntryFacts, user: UserSignals = USER) -> float:
    return ranked(facts, user).score


RULES: list[tuple[str, EntryFacts, EntryFacts]] = [
    ("topic match", BASE, replace(BASE, topics=frozenset({"backend"}))),
    ("level fit", BASE, replace(BASE, difficulty="beginner")),
    ("source quality", replace(BASE, quality=5), replace(BASE, quality=2)),
    (
        "freshness",
        replace(BASE, published_at=NOW),
        replace(BASE, published_at=NOW - timedelta(days=60)),
    ),
    ("time fit", replace(BASE, minutes=6), replace(BASE, minutes=12)),
]


@pytest.mark.parametrize(("rule", "better", "worse"), RULES)
def test_each_rule_moves_the_score_the_expected_way(
    rule: str, better: EntryFacts, worse: EntryFacts
) -> None:
    assert one(better) > one(worse), rule


def test_on_topic_counts_however_the_candidate_was_found() -> None:
    similar_only = Candidate(1, 10, 100, {"similar"})
    (scored,) = score([similar_only], {BASE.key: BASE}, USER, CONFIG, NOW)
    assert scored.score == one(BASE)


def test_a_level_two_steps_away_scores_lowest() -> None:
    near = one(replace(BASE, difficulty="advanced"))
    far = one(replace(BASE, difficulty="beginner"), replace(USER, level="advanced"))
    assert one(BASE) > near > far


def test_unknowns_sit_between_the_extremes() -> None:
    expert = replace(USER, level="advanced")
    two_apart = one(replace(BASE, difficulty="beginner"), expert)
    untagged = one(replace(BASE, difficulty=None), expert)
    assert two_apart < untagged < one(replace(BASE, difficulty="advanced"), expert)
    assert one(replace(BASE, quality=1)) < one(replace(BASE, quality=None))
    assert one(replace(BASE, quality=None)) < one(replace(BASE, quality=5))
    assert one(replace(BASE, published_at=None)) < one(BASE)


def test_time_fit_holds_to_the_break_then_falls_to_nothing() -> None:
    assert one(replace(BASE, minutes=8)) == one(replace(BASE, minutes=1))
    assert one(replace(BASE, minutes=16)) == one(replace(BASE, minutes=30))


def test_less_like_this_and_not_interested_concepts_push_down() -> None:
    disliked = replace(USER, less_liked=frozenset({BASE.item_id}))
    assert one(BASE, disliked) < one(BASE)
    both = replace(BASE, concepts=frozenset({"raft", "paxos"}))
    half = one(both, replace(USER, avoided_concepts=frozenset({"raft"})))
    whole = one(both, replace(USER, avoided_concepts=frozenset({"raft", "paxos"})))
    assert one(both) > half > whole


def test_the_top_signal_is_recorded_for_the_why_note() -> None:
    assert ranked(BASE).top_signal == "topic_match"  # the largest weighted part
    off_topic = replace(BASE, topics=frozenset({"backend"}), quality=5)
    assert ranked(off_topic).top_signal == "time_fit"


def test_a_candidate_whose_moment_is_gone_is_skipped() -> None:
    candidate = Candidate(99, 10, 100, {"topic"})
    assert score([candidate], {}, USER, CONFIG, NOW) == []


def pick(pool: dict[int, EntryFacts], config: RankingConfig, limit: int) -> list[int]:
    candidates = [
        Candidate(f.moment_id, f.item_id, f.source_id, {"topic"}) for f in pool.values()
    ]
    keyed = {f.key: f for f in pool.values()}
    scored = score(candidates, keyed, USER, config, NOW)
    picked = rerank(scored, keyed, config, limit)
    return [r.moment_id for r in picked if r.moment_id is not None]  # moments only


def facts(
    moment_id: int, item_id: int, source_id: int, concepts: set[str]
) -> EntryFacts:
    return replace(
        BASE,
        moment_id=moment_id,
        item_id=item_id,
        source_id=source_id,
        concepts=frozenset(concepts),
    )


def test_the_per_source_cap_holds() -> None:
    pool = {i: facts(i, i, 100 if i <= 4 else 200, {f"c{i}"}) for i in range(1, 7)}
    sources = [pool[m].source_id for m in pick(pool, CONFIG, 10)]
    assert sources.count(100) == 2 and sources.count(200) == 2


def same_item(i: int) -> EntryFacts:
    return facts(i, 10, 100 + i, {f"own{i}"})  # moments of one article


def same_concepts(i: int) -> EntryFacts:
    return facts(i, 10 + i, 100 + i, {"raft"})  # different articles, same concepts


def same_source(i: int) -> EntryFacts:
    return facts(i, 10 + i, 100, {f"own{i}"})  # one source, unrelated concepts


@pytest.mark.parametrize("alike", [same_item, same_concepts, same_source])
def test_mmr_keeps_alike_moments_apart(alike: Callable[[int], EntryFacts]) -> None:
    # Three alike moments score a little above two unrelated ones; a weak, off-topic
    # sixth sets the scale, as a real pool's long tail does.
    pool = {i: replace(alike(i), quality=5) for i in (1, 2, 3)}
    pool[4] = facts(4, 40, 400, {"indexes"})
    pool[5] = facts(5, 50, 500, {"caching"})
    pool[6] = replace(
        facts(6, 60, 600, {"misc"}),
        topics=frozenset({"backend"}),
        quality=1,
        published_at=NOW - timedelta(days=90),
    )
    order = pick(pool, replace(CONFIG, per_source_cap=10), 5)
    assert order[0] in (1, 2, 3), alike.__name__
    assert order[1] in (4, 5), alike.__name__  # the next pick isn't alike the first
    assert sorted(order) == [1, 2, 3, 4, 5]


def test_weights_come_from_the_one_config() -> None:
    louder = replace(CONFIG, weights={**CONFIG.weights, "quality": 4.0})
    candidate = Candidate(1, 10, 100, {"topic"})
    (low,) = score([candidate], {BASE.key: BASE}, USER, CONFIG, NOW)
    (high,) = score([candidate], {BASE.key: BASE}, USER, louder, NOW)
    assert high.score > low.score


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"mmr.lambda": None}, "lacks mmr.lambda"),
        ({"freshness.half_life_days": 0}, "half_life"),
        ({"mmr.lambda": 1.5}, "between 0 and 1"),
        ({"cap.per_source": 0}, "whole number"),
        ({"cap.per_source": 4.5}, "whole number"),
        # Postgres numeric holds NaN and Infinity; either would scramble every score.
        ({"freshness.half_life_days": float("nan")}, "finite"),
        ({"weight.quality": float("inf")}, "finite"),
        ({"cap.per_source": float("inf")}, "finite"),
        # A negative penalty would turn Less like this into a boost.
        ({"penalty.less_like_this": -1.0}, "0 or more"),
        ({"weight.topic_match": -0.5}, "0 or more"),
    ],
)
def test_a_config_that_would_break_ranking_is_refused(
    change: dict[str, float | None], message: str
) -> None:
    rows: dict[str, float] = dict(RANKING_DEFAULTS)
    for key, value in change.items():
        if value is None:
            del rows[key]
        else:
            rows[key] = value
    with pytest.raises(RankingConfigError, match=message):
        RankingConfig.from_rows(rows)


def test_short_moments_fit_a_long_break_less() -> None:
    # Owner, 2026-10-26: 8-15 is for long reads; short moments rank below them.
    long_break = replace(USER, break_length="8-15")
    one_minute = one(replace(BASE, minutes=1), long_break)
    four_minutes = one(replace(BASE, minutes=4), long_break)
    eight = one(replace(BASE, minutes=8), long_break)
    assert one_minute < four_minutes < eight
    assert eight == one(replace(BASE, minutes=15), long_break)


def test_the_shortest_break_allows_up_to_three_minutes() -> None:
    short_break = replace(USER, break_length="1-3")
    assert one(replace(BASE, minutes=1), short_break) == one(
        replace(BASE, minutes=3), short_break
    )
    assert one(replace(BASE, minutes=4), short_break) < one(
        replace(BASE, minutes=3), short_break
    )


def test_a_future_date_counts_as_brand_new() -> None:
    assert one(replace(BASE, published_at=NOW + timedelta(days=2))) == one(
        replace(BASE, published_at=NOW)
    )


def test_equal_scores_keep_moment_order() -> None:
    twins = {
        m: replace(BASE, moment_id=m, item_id=10 + m, source_id=100 + m)
        for m in (3, 1, 2)
    }
    candidates = [
        Candidate(m, f.item_id, f.source_id, {"topic"}) for m, f in twins.items()
    ]
    keyed = {f.key: f for f in twins.values()}
    picked = rerank(score(candidates, keyed, USER, CONFIG, NOW), keyed, CONFIG, 3)
    assert [s.moment_id for s in picked] == [1, 2, 3]


def test_an_article_of_unknown_length_fits_less_than_one_that_fits() -> None:
    # Q-P1-39, owner 2026-10-26: unknown length is neither a fit nor a miss.
    long_break = replace(USER, break_length="8-15")
    article = replace(BASE, moment_id=None, minutes=12)
    fits = one(article, long_break)
    unknown = one(replace(article, minutes=None), long_break)
    misses = one(replace(article, minutes=30), long_break)
    assert fits > unknown > misses


def test_on_a_tie_an_article_comes_before_its_own_moments() -> None:
    article = replace(BASE, moment_id=None)
    pool = {f.key: f for f in (BASE, article)}
    candidates = [
        Candidate(f.moment_id, f.item_id, f.source_id, {"topic"}) for f in pool.values()
    ]
    picked = rerank(score(candidates, pool, USER, CONFIG, NOW), pool, CONFIG, 2)
    assert [s.moment_id for s in picked] == [None, BASE.moment_id]


@pytest.mark.parametrize("share", [-0.1, 0.51, float("nan")])
def test_an_exploration_share_outside_0_to_half_is_refused(share: float) -> None:
    with pytest.raises(RankingConfigError, match=r"explore\.share"):
        RankingConfig.from_rows({**RANKING_DEFAULTS, "explore.share": share})
