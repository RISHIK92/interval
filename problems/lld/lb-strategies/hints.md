> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If each strategy kept its own copy of the connection counts, what would switching strategies lose?

## Approach

Keep the backends, with their weights and open connection counts, in the balancer, in the order they were added. A strategy is a small object with one method that chooses from that list, and it keeps only what it needs to remember between picks: round robin the position it picked last, weighted round robin a current weight per backend, least connections nothing at all. Picking asks the current strategy and then opens the connection on the chosen backend; switching just replaces the strategy object with a new one. Look up strategies by name in a table so an unknown name fails before anything changes.

## Code sketch

```text
record Backend(name, weight, open = 0)

interface Strategy
  choose(backends) -> Backend

class RoundRobin implements Strategy
  last = -1
  choose(backends)     // TODO: the next one after last, wrapping
class LeastConnections implements Strategy
  choose(backends)     // TODO: fewest open, first added wins a tie
class SmoothWeighted implements Strategy
  current: map name -> int
  choose(backends)     // TODO: grow by weight, take the largest, give back the total

class Balancer
  backends: list of Backend; byName: map name -> Backend
  strategy: Strategy   // TODO: a fresh one from a table of names
  addBackend(name, weight)
  pick() -> string     // TODO: strategy.choose, then open += 1
  done(backend)        // TODO: fail on unknown or open == 0
  useStrategy(strategy)
```
