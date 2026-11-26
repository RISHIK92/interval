> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If "which shard holds this key?" were one small object per strategy, what would `rebalance` need to know about which strategy is in use?

## Approach

Make each strategy an object with a single operation: given a key and the shard count, return the key's shard or nothing. Hash and range are pure arithmetic; the directory strategy reads the router's directory table, which the router owns and keeps whatever the strategy. The router holds the shard count, the chosen strategy object, the tracked keys and the directory. To count moves, take a snapshot of every tracked key's shard (nothing included) before the change, make the change, take another, and count the keys whose two values differ. A rebalance also folds directory entries that point past the new count back with a modulo, between the two snapshots.

## Code sketch

```text
interface Strategy
  shard(key, shards) -> int or none

class HashModulo, KeyRange               // TODO: the statement's formulas
class Directory(entries)                 // TODO: entries[key] or none

class ShardRouter
  shards, strategy, directory: map, tracked: set

  constructor(shards, strategy)          // TODO: validate, pick
  route(key) -> int                      // TODO: fail on none
  track(key)                             // TODO
  assignDirectory(key, shard)            // TODO: validate range
  rebalance(shards) -> int
    // TODO: before = placement(); change count; fold entries
    // TODO: count keys where placement() differs from before
  placement() -> map key -> shard or none
```
