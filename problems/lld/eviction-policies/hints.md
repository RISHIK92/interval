> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If each entry remembers its own history, how little does a policy need to know to pick a victim?

## Approach

Keep one map of entries, each with its value, the moment it arrived, the moment it was last used and how many times it has been used, stamped from a single counter that ticks on every use. Make each policy a small strategy object with one job: rank an entry (last use; use count then last use; arrival). Evicting is "the unpinned entry with the lowest rank under the current strategy", and switching policies is just swapping which strategy the cache holds, so no history ever has to be rebuilt.

## Code sketch

```text
class Entry
  value, arrived, lastUsed, uses

interface Policy
  rank(entry) -> comparable
class Lru, Lfu, Fifo implements Policy   // TODO: one line each

class EvictingCache
  entries: map key -> Entry
  policy: Policy
  clock = 0

  use(entry)                          // TODO: stamp lastUsed, count it
  put(key, val)
    // TODO: cached? update value and use it
    // TODO: full? remove the lowest-ranked entry
    // TODO: add a new Entry stamped now
  lookup(key) -> int or none          // TODO: a hit is a use
  keys() -> list                      // TODO: sorted
  switchPolicy(policy)                // TODO: swap the strategy
```
