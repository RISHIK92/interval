> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If `total()` had to ask each instance what kind it is before adding up its bill, what would change when a fourth kind arrived?

## Approach

Make an abstract instance that keeps its rate and the hours it has run, and has one abstract method: what it has cost. Each kind is a subclass that fills that method in with its own rule, so the reserved fee and the spot discount live in their own classes. Interruption belongs to spot alone: the base class refuses it, and the spot class overrides it and stops counting hours once interrupted. The meter maps an id to an instance; `run`, `bill`, `total` and `interrupt` only ever call the instance's own methods. The one place kinds are named is where `launch` turns a kind string into a subclass, which is also where an unknown kind fails.

## Code sketch

```text
abstract class Instance
  hourly, hours = 0
  run(hours)            // hours += hours
  bill() -> int         // abstract
  interrupt() -> bool   // fails: only spot can be interrupted

class OnDemand, Reserved extends Instance
  // TODO: each its own bill(), rounding down once over all hours
class Spot extends Instance
  // TODO: interrupted flag; run() adds hours only before it
  // TODO: interrupt(): true the first time, false after

class BillingMeter
  instances: map id -> Instance

  launch(id, kind, hourlyCents)
    // TODO: fail on an unknown kind, a bad rate, an empty or used id
  run(id, hours)
    // TODO: fail on bad hours or an unknown id; instance.run(hours)
  bill(id) / interrupt(id)
    // TODO: fail when unknown; ask the instance
  total() -> int
    // TODO: sum of every instance.bill()
```
