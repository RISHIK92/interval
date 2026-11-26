> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If every event type had one function that turns a state into the next state, which two parts of this problem could share those functions?

## Approach

Keep one table from event type to an apply function (state and event in, new state out), and use it twice: when a command is accepted, to move the subscription's current state forward, and when rebuilding a past state, to replay. Each command is a small object holding its argument range and the rule it's checked by against the current state, so `handle` is just validate, look up, check, store. Make states immutable values: a snapshot is then just the count of events it covers plus the state after them, and rebuilding starts from the newest snapshot whose last event isn't later than the time asked for, replaying the rest in order until an event is too late and counting each one applied.

## Code sketch

```text
State(status, tier, pausedUntil)     // immutable; none = no state yet
shown(state, now) -> string          // TODO: none / active / paused / cancelled

APPLY: event type -> (state, event) -> state

class Command
  eventType, low, high
  allowed(state, arg, now) -> bool

class Stream
  events, current, snapshots: list of (count, state)

class SubscriptionLedger
  streams, every, replayed, last
  handle(command, sub, arg, nowMs) -> bool   // TODO: validate, check, store, snapshot
  events(sub) -> list of string              // TODO
  stateAt(sub, nowMs) -> string              // TODO: newest usable snapshot, replay
  snapshotEvery(n)                           // TODO
  replays() -> int                           // TODO
```
