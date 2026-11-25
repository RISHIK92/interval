> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

Instead of an `if` per method asking which states it may start from, where could every legal move be written down once?

## Approach

Model the state as an enumeration (or a closed union of names), never a free string, and keep it private. Write the legal moves down once, as a table from (call, current state) to the next state; one private `move` looks the pair up, and either changes the state and reports true or reports false and changes nothing. `connect`, `disconnect` and `fail` are then one line each, after `fail` has checked its reason. `state()` turns the enumeration into its name only at the edge.

## Code sketch

```text
enum State { IDLE, OPEN, CLOSED, FAILED }

MOVES: map (action, from) -> to
  // TODO: connect: IDLE -> OPEN; disconnect: OPEN -> CLOSED
  // TODO: fail: IDLE -> FAILED and OPEN -> FAILED

class Connection
  current: State = IDLE

  constructor(host)
    // TODO: fail on an empty host
  move(action) -> bool
    // TODO: look up (action, current); false when absent
    // TODO: otherwise switch to the new state; true
  connect() -> bool / disconnect() -> bool
    // TODO: move(...)
  fail(reason)
    // TODO: fail on an empty reason, then move("fail")
  state() -> string
    // TODO: the enum's name in lower case
```
