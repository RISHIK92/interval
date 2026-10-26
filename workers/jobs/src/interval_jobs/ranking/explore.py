"""Exploration by Thompson sampling (REC-4, REC-3 novelty slots, P1-W4-S09).

A share of a user's slots per chip goes to arms: topics the user didn't choose and
sources new to them. Each slot draws from every arm's Beta(1 + finished, 1 + shown -
finished), counted across all users, and the highest draw's best entry fills it. Until
Week 5 records outcomes, every arm is at its prior and the draws are even.
"""

import random
from collections import Counter
from collections.abc import Mapping, Sequence

from interval_jobs.ports import Arm, ArmOutcome
from interval_jobs.ranking.scoring import Scored

_PRIOR = ArmOutcome(0, 0)


def sample_arm(
    arms: Sequence[Arm], outcomes: Mapping[Arm, ArmOutcome], rng: random.Random
) -> Arm:
    def draw(arm: Arm) -> float:
        seen = outcomes.get(arm, _PRIOR)
        return rng.betavariate(1 + seen.finished, 1 + seen.shown - seen.finished)

    return max(arms, key=draw)


def explore(
    main: list[Scored],
    pool: Mapping[Arm, list[Scored]],
    slots: int,
    outcomes: Mapping[Arm, ArmOutcome],
    rng: random.Random,
    per_source_cap: int,
) -> list[Scored]:
    """`main` with up to `slots` explored entries spread through it: one after every
    len(main) / slots, so exploration never crowds the top. One article appears once,
    and a source's entries stay within the cap, as re-ranking keeps them (REC-3)."""
    items = {s.item_id for s in main}
    per_source = Counter(s.source_id for s in main)

    def open_to(s: Scored) -> bool:
        return s.item_id not in items and per_source[s.source_id] < per_source_cap

    left = {
        arm: sorted(entries, key=lambda s: -s.score) for arm, entries in pool.items()
    }
    explored: list[Scored] = []
    while len(explored) < slots:
        left = {arm: [s for s in e if open_to(s)] for arm, e in left.items()}
        left = {arm: e for arm, e in left.items() if e}
        if not left:
            break
        arms = sorted(left, key=lambda a: (a.kind, a.key))
        best = left[sample_arm(arms, outcomes, rng)][0]
        explored.append(best)
        items.add(best.item_id)
        per_source[best.source_id] += 1
    if not explored:
        return list(main)
    step = max(1, len(main) // len(explored))
    feed = list(main)
    for n, entry in enumerate(explored):
        feed.insert(min(len(feed), (n + 1) * step + n), entry)
    return feed
