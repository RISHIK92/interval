> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

Which two checks must pass before any number changes, so that a refused call leaves everything exactly as it was?

## Approach

Hide the numbers behind the methods: a map from owner to bytes held, and a running total of everything held, changed only by `reserve` and `release`. Each method validates first (amount at least 1; for `reserve`, the bytes fit in the limit minus the total; for `release`, no more than the owner holds) and only then updates the map and the total together. Then the two invariants, no owner below zero and the total never past the limit, can't be broken from outside.

## Code sketch

```text
class DiskQuota
  limit
  total            // everything held, kept in step with held
  held: map owner -> bytes

  constructor(limitBytes)
    // TODO: fail on a negative limit
  reserve(owner, bytes) -> bool
    // TODO: fail when bytes < 1
    // TODO: false when bytes > limit - total
    // TODO: add to the owner and to the total; true
  release(owner, bytes)
    // TODO: fail when bytes < 1 or bytes > what the owner holds
    // TODO: take from the owner and from the total
  used(owner) -> int
    // TODO: the owner's bytes, 0 when unknown
  free() -> int
    // TODO: limit - total
```
