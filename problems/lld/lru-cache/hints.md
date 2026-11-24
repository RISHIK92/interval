> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

After a hit on a key in the middle of the order, how do you make it the most recent without walking past every other key?

## Approach

Combine a hash map with a doubly linked list (or a language's insertion-ordered map that can move a key to the end): the map finds a key in O(1), and the list keeps recency, most recent at one end and the eviction candidate at the other. A hit or a put moves its key to the recent end; a miss changes nothing. The invariant: the map and the list always hold the same keys, and after a put there are never more than `capacity` of them.

## Code sketch

```text
class LRUCache
  capacity
  index: map key -> list node (key, value)
  order: doubly linked list, most recent at the front
  lock

  constructor(capacity)
    // TODO: fail if capacity < 1
  lookup(key) -> optional<int>
    // TODO: null on a miss (no change); on a hit, move it to the front
  put(key, value)
    // TODO: reject a negative value; insert or update at the front
    // TODO: evict from the back when past capacity
  size() -> int
    // TODO: how many keys are cached
  keys() -> list<string>
    // TODO: the keys from most to least recent
```
