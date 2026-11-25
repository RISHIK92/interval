> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If two parts of a process each kept their own last timestamp and sequence for the same node, what would stop them issuing the same ID?

## Approach

There is one source per process, so it alone holds the state that makes IDs unique: the last timestamp it used and the sequence it reached there, plus a count of IDs issued. Each call first checks its reading, then decides the timestamp: a later reading starts a fresh millisecond at sequence 0, anything else stays on the last timestamp and moves the sequence on, and a millisecond whose sequence space is used up hands over to the one after it. Formatting with fixed-width, zero-padded fields is what keeps the IDs sortable as plain strings.

## Code sketch

```text
class TraceIds
  node
  lastMs = -1
  sequence
  issued = 0

  constructor(nodeId)
    // TODO: fail outside 0..1023

  nextId(nowMs) -> string
    // TODO: fail outside 0..10^12
    // TODO: later than lastMs: a new millisecond, sequence 0
    // TODO: otherwise: the next sequence on lastMs
    // TODO: sequence space used up: borrow lastMs + 1
    issued += 1
    // TODO: pad: 13 digits - 4 digits - 3 digits

  issued() -> int
  lastMs() -> int
```
