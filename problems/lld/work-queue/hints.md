> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

For each method, which unmet condition is the caller's fault (fail) and which is just a busy queue (false)?

## Approach

Write each method's precondition as the first lines of its body and fail when it's broken: a capacity out of range, an empty item, taking from an empty queue. A full queue isn't a broken precondition, it's an expected outcome, so `offer` reports it with false and changes nothing. Store the items in a structure with O(1) removal at the front: a deque, or a fixed array of `capacity` slots used as a ring with a head index and a count. With a ring, the next free slot is `(head + count) mod capacity`, and taking advances `head` the same way. `peekNext` only reads.

## Code sketch

```text
class WorkQueue
  slots: array of capacity strings
  head = 0, count = 0

  constructor(capacity)
    // TODO: fail unless 1 <= capacity <= 10^3
  offer(item) -> bool
    // TODO: fail on an empty item
    // TODO: false when count == capacity
    // TODO: store at the back of the ring
  take() -> string
    // TODO: fail when count == 0
    // TODO: remove and return the front item
  peekNext() -> optional string
    // TODO: none when empty, else slots[head]
  size() -> int
```
