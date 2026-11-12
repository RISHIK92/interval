# LRU cache

> PROVISIONAL (P5-W30-S03): written during the build; the owner reviews it before launch.

Build a cache that holds at most `capacity` entries and, when full, evicts the entry used
least recently.

- `LRUCache(capacity)`: `capacity` is at least 1, or the constructor fails.
- `lookup(key)`: the key's value, or null when it isn't cached. A hit makes the key the most
  recently used; a miss changes nothing.
- `put(key, value)`: stores the value (0 or more; a negative value fails and changes
  nothing). The key becomes the most recently used. When a new key would take the cache
  past its capacity, the least recently used key is evicted first.
- `size()`: how many keys are cached.
- `keys()`: every cached key, most recently used first.

Several threads may call `put` and `lookup` at once (JavaScript and TypeScript: interleaved
async calls). Every completed call must count.
