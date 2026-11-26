> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

What does a watcher have to remember so that it can tell, on its own, whether this update is news?

## Approach

Make each service a subject that owns its counts and an ordered collection of watchers, and make each watcher an observer that keeps its threshold and whether it is burning. After an observation updates the counts, the service computes its burn once and hands it to every watcher in order; a watcher compares "burn at least my threshold" with its remembered state and returns a message only when the two differ, updating its state. Keep the burn formula in one place and use integer arithmetic, so the threshold check and the budget left can never disagree.

## Code sketch

```text
class Watcher
  subscriber, threshold, burning = false
  update(burn) -> message or none     // TODO: speak only on a flip

class Service
  good = 0, bad = 0
  watchers: ordered map subscriber -> Watcher
  burn(allowed) -> int                // TODO: floor, 0 with no traffic

class SloMonitor
  allowed = 1000 - objective
  services: map name -> Service

  watch(subscriber, service, percent) // TODO: add or re-threshold
  observe(service, good, bad) -> list
    // TODO: add counts, compute the burn once
    // TODO: collect each watcher's update
  budgetLeft(service) -> int          // TODO: 100 - burn
```
