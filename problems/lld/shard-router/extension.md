# Shard routing: switching strategy (extension round)

> PROVISIONAL (LLD practice batch 8c, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Hash routing spreads keys evenly but makes range scans expensive, so the team wants to
try the other strategies on a live router, and to know the cost of each switch first.

- `useStrategy(strategy)`: the router routes by `strategy` from now on, and the call
  returns how many tracked keys moved: the keys whose shard under the new strategy
  differs from their shard under the old one, with no shard counting as a value of its
  own, as in `rebalance`. Switching to the strategy in use returns `0`. A strategy
  other than the three fails.
  - The shard count, the tracked keys and the directory stay as they are.
