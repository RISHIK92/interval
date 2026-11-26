> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

What if the question "is this move allowed, and where does it lead?" were answered by the current state itself rather than by the rollout?

## Approach

Give every state its own small object with one method per move, each returning the state it leads to or nothing when the move isn't allowed; a base state that refuses everything means each state only overrides the moves it has. Canary and rolling behave alike, differing only in their name, their traffic and the state they advance to. A paused state keeps the state it paused so resuming can return it. The rollout itself holds the service, the version and the current state, and every public move is the same three lines: ask the state, and if it answered, switch to the answer.

## Code sketch

```text
class State                    // refuses every move
  name, traffic
  begin() / advance() / pause() / resume() / abort() -> State or none

class Pending : State          // TODO: begin -> canary
class Moving : State           // canary and rolling
  next                         // TODO: advance, pause, abort
class Paused : State
  was                          // TODO: resume -> was
// done and rolled-back: plain States

class Rollout
  service, version, state = Pending

  move(to) -> bool             // TODO: none? false; else switch
  begin(version) -> bool       // TODO: fail on empty; record it
  advance() -> bool            // TODO: move(state.advance())
  status() -> string           // TODO
```
