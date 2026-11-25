> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

For any connection name the pool is asked about, which of a few states can it be in, and what does each call need to look up to tell them apart quickly?

## Approach

Keep the state of every connection in collections that can't overlap: an ordered list of idle connections (most recently released at the end), a map of held connections to their client, and a record of every name ever opened, so a discarded one is simply in that record but in neither of the others. Acquiring takes from the end of the idle list; only when it is empty does it compare the number held against the maximum and open a new connection. Releasing moves a name from held to the end of the idle list; invalidating removes it from whichever of the two has it. The counters are just sizes of these collections.

## Code sketch

```text
class ConnPool
  max: int
  opened: set of names       // every one ever made
  idleList: list of names    // most recent last
  held: map name -> client

  constructor(maxSize)
    // TODO: fail outside 1..1000
  acquire(client) -> optional string
    // TODO: fail on an empty client
    // TODO: reuse the newest idle one, if any
    // TODO: else open conn-n if held < max, else null
  release(conn) -> bool
    // TODO: fail if never opened; false unless held
    // TODO: move it to the end of idleList
  invalidate(conn) -> bool
    // TODO: fail if never opened
    // TODO: remove from idleList or held; false if neither
  created() -> int
  idle() -> int
```
