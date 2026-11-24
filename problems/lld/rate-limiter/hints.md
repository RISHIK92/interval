> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

At time `nowMs`, which of a client's past requests still count against it, and what should a refused request leave behind?

## Approach

Keep, per client, a queue of the timestamps of its allowed requests, oldest first, and the time of its last call. Each call first drops from the front the timestamps that have slid out of the window `(nowMs - windowMs, nowMs]`, then counts what is left; only an allowed request is appended. The invariant: a client's queue never holds more than `limit` timestamps inside the window, and its time never runs backwards. One lock around each call keeps concurrent calls from losing a request.

## Code sketch

```text
class RateLimiter
  limit, windowMs
  log:  map client -> queue of allowed timestamps, oldest first
  last: map client -> time of its previous call
  lock

  constructor(limit, windowMs)
    // TODO: fail unless both are at least 1
  allow(client, nowMs) -> bool
    // TODO: fail if time ran backwards for this client; record its time
    // TODO: trim the window; allow and record only when under the limit
  remaining(client, nowMs) -> int
    // TODO: same time check and trim; how many more it may make now
```
