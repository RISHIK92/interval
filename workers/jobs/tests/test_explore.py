"""Thompson sampling for exploration (REC-4, REC-3 novelty slots, P1-W4-S09): each
arm is Beta(1 + finished, 1 + shown - finished); a sampled arm fills a slot with its
best entry; explored entries are spread through the feed."""

import random
from datetime import UTC, datetime

from interval_jobs.ports import Arm, ArmOutcome, Breakdown, EntryFacts
from interval_jobs.ranking.explore import explore, sample_arm
from interval_jobs.ranking.scoring import Scored

CAP = 10
DB = Arm("topic", "databases")
BACKEND = Arm("topic", "backend")


def test_an_arm_with_more_finishes_is_chosen_more_often() -> None:
    rng = random.Random(7)
    outcomes = {DB: ArmOutcome(shown=40, finished=30), BACKEND: ArmOutcome(40, 5)}
    picks = [sample_arm([DB, BACKEND], outcomes, rng) for _ in range(10_000)]
    assert picks.count(DB) > 9_000


def test_arms_with_no_data_share_the_draws() -> None:
    rng = random.Random(7)
    picks = [sample_arm([DB, BACKEND], {}, rng) for _ in range(10_000)]
    assert 4_500 < picks.count(DB) < 5_500


def entry(
    n: int, score: float = 1.0, item: int | None = None, source: int | None = None
) -> Scored:
    item = n if item is None else item
    source = n if source is None else source
    facts = EntryFacts(
        n,
        item,
        source,
        5,
        None,
        datetime(2026, 10, 1, tzinfo=UTC),
        None,
        frozenset(),
        frozenset(),
        "S",
    )
    return Scored(
        n,
        item,
        source,
        score,
        "freshness",
        facts,
        Breakdown({}, {}, {}, 0),
    )


def test_explored_entries_fill_only_their_slots_spread_through_the_feed() -> None:
    main = [entry(n) for n in range(1, 10)]  # 9 main picks
    pool = {DB: [entry(101, 0.9), entry(102, 0.5)], BACKEND: [entry(201)]}
    feed = explore(main, pool, 1, {}, random.Random(1), CAP)
    assert len(feed) == 10
    explored = [s for s in feed if s.item_id > 100]
    assert len(explored) == 1
    # One slot in ten: the explored entry is not stacked at the top.
    assert feed.index(explored[0]) > 0


def test_an_arm_gives_its_best_entry_and_never_one_twice() -> None:
    main = [entry(n) for n in range(1, 4)]
    pool = {DB: [entry(102, 0.5), entry(101, 0.9)]}
    feed = explore(main, pool, 2, {}, random.Random(1), CAP)
    assert [s.item_id for s in feed if s.item_id > 100] == [101, 102]


def test_no_slots_or_no_pool_leaves_the_main_feed_as_it_was() -> None:
    main = [entry(n) for n in range(1, 4)]
    assert explore(main, {DB: [entry(101)]}, 0, {}, random.Random(1), CAP) == main
    assert explore(main, {}, 3, {}, random.Random(1), CAP) == main


def test_an_entry_already_in_the_feed_is_not_explored_again() -> None:
    main = [entry(1), entry(2)]
    feed = explore(main, {DB: [entry(1)]}, 1, {}, random.Random(1), CAP)
    assert feed == main


def test_an_article_already_in_the_feed_is_not_added_again_as_another_moment() -> None:
    main = [entry(1, item=50)]
    pool = {DB: [entry(2, item=50), entry(3, item=60), entry(4, item=60)]}
    feed = explore(main, pool, 3, {}, random.Random(1), CAP)
    assert [s.item_id for s in feed].count(50) == 1
    assert [s.item_id for s in feed].count(60) == 1


def test_explored_entries_respect_the_per_source_cap() -> None:
    main = [entry(1, source=9), entry(2, source=9)]
    pool = {DB: [entry(n, source=9) for n in range(101, 106)]}
    feed = explore(main, pool, 5, {}, random.Random(1), 3)
    assert [s.source_id for s in feed].count(9) == 3
