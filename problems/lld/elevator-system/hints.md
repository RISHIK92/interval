> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

Within one `step()`, can an elevator both move and open its doors, and which of its stops decides the direction it moves?

## Approach

Keep, per elevator, its current floor and a set of stop floors, all under one lock so each call is atomic. An elevator's target is its nearest stop (ties to the lower floor); `step` moves each elevator that has stops one floor toward its target and opens its doors if it now stands on a stop. `request` picks by cost (distance plus number of stops), but an elevator that already stops at the floor wins before any cost is computed. The invariant: a stop leaves the set exactly when its doors open there.

## Code sketch

```text
class ElevatorSystem
  floorOf: per elevator, its current floor (all start at 0)
  stops:   per elevator, a set of stop floors
  top:     the top floor
  lock

  constructor(elevators, floors)
    // TODO: fail unless both are at least 1
  target(elevator)
    // TODO: the stop nearest its floor, ties to the lower floor
  request(floor) -> int
    // TODO: validate; reuse an elevator that already stops there
    // TODO: else add the stop to the lowest-cost elevator; return its number
  press(elevator, floor) -> bool
    // TODO: validate both; add the stop; false if it was already there
  step() -> list<string>
    // TODO: each elevator with stops moves toward its target, opens on a stop
    // TODO: return "<elevator>:<floor>" per door opened, in elevator order
  status(elevator) -> string
    // TODO: "<floor> <idle|up|down|here> <stops ascending, or ->"
```
