# Pluggable eviction

> PROVISIONAL (LLD practice batch 8b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A bounded cache has to drop a key whenever a new one arrives and it is full. Which key
goes depends on the eviction policy, and operators want to switch policies on a live
cache without losing what it has learned about its keys.

| Policy | Evicts                                                                  |
| ------ | ----------------------------------------------------------------------- |
| `lru`  | the key used least recently                                             |
| `lfu`  | the key used the fewest times; among those, the one used least recently |
| `fifo` | the key that arrived first, however it has been used since              |

A key is **used** when it arrives, when `put` updates it, and when `lookup` finds it. A
lookup that misses uses nothing. Every cached key keeps its usage history (when it
arrived, when it was last used, and how many times it has been used since it arrived)
whatever the policy, so a policy switched to later sees uses made under earlier ones. An
evicted key's history is forgotten: if it comes back, it arrives as a new key.

- `EvictingCache(capacity, policy)`: an empty cache. A capacity below 1 or a policy not
  in the table fails.
- `put(key, val)`: when the key is cached, replaces its value (an update keeps its place
  in `fifo`). Otherwise, when the cache is full, first evicts one key by the current
  policy, then caches the new key.
- `lookup(key)`: the key's value, or null when it isn't cached.
- `keys()`: the cached keys, sorted.
- `switchPolicy(policy)`: evictions from now on follow `policy`. A policy not in the
  table fails.

An empty key fails, in every call, and a call that fails changes nothing. Keys and policy
names are printable ASCII and case-sensitive, and "sorted" means by character code. Values
are integers from -(2^53 - 1) to 2^53 - 1, the capacity is at most 1000, and there are at most 10^4 calls.

For example, with capacity 2 and `lru`: `put("a", 1)`, `put("b", 2)`, `lookup("a")`, then
`put("c", 3)` evicts `b`, so `keys()` returns `["a", "c"]`. Had the policy been `fifo`,
`a` would have gone instead.
