> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If every method started with a switch on the current state, how many places would a fourth state touch?

## Approach

Make each state a small object with the same methods: allow, success, failure, and a tick that says whether time alone moves it on. Every event method returns the state the breaker is in afterwards, often itself, so the breaker just replaces its current state with whatever comes back. Each state holds only its own data: closed counts failures in a row, open remembers when it opened, half-open remembers whether its trial is out. The breaker's own methods all start the same way: check the time, let the current state tick, then hand the event to it.

## Code sketch

```text
interface State
  name -> string
  tick(nowMs) -> State          // default: itself
  allow() -> bool               // default: false
  success(nowMs) -> State       // default: itself
  failure(nowMs) -> State       // default: itself

class Closed: failures          // TODO: count, open at threshold
class Open: openedMs            // TODO: tick -> HalfOpen after cool-down
class HalfOpen: trial = false   // TODO: one allow; outcome only after it

class CircuitBreaker(threshold, coolDownMs)
  current: State = Closed; lastMs = 0
  at(nowMs) -> State
    // TODO: fail if nowMs < lastMs; lastMs = nowMs
    // TODO: current = current.tick(nowMs); return current
  allow(nowMs) -> bool          // at(nowMs).allow()
  failure(nowMs)                // current = at(nowMs).failure(nowMs)
  state(nowMs) -> string
```
