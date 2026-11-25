> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

Capping, `schedule` and `totalMs` are identical for all three kinds. What is the one piece that actually differs, and could it be an object you swap?

## Approach

Make a small growth interface with one method: the delay before attempt `n` for a given base. Write one implementation per kind and keep them in a map from kind name to growth. The schedule holds the current growth plus `baseMs` and `capMs`; `delay` checks the attempt, asks the growth and applies the cap, and `schedule` and `totalMs` are built on `delay`, so they never mention kinds. `switchTo` only replaces the growth object. In languages with fixed-width integers, let the growth itself stop growing once it reaches the cap, so 2^999 never has to be computed.

## Code sketch

```text
interface Growth
  delay(attempt, base, cap) -> int

Fixed, Linear, Exponential implement Growth
  // TODO: base | base * n | doubled n - 1 times, stopping at cap
KINDS = map "fixed"/"linear"/"exponential" -> Growth

class BackoffSchedule
  growth, base, cap

  constructor(kind, baseMs, capMs)
    // TODO: fail on an unknown kind or unless 1 <= base <= cap <= 10^9
  delay(attempt) -> int
    // TODO: fail unless 1 <= attempt <= 1000; growth.delay, capped
  schedule(attempts) -> list
    // TODO: fail unless 0 <= attempts <= 1000; delay(1..attempts)
  totalMs(attempts) -> int    // TODO: sum of schedule(attempts)
  switchTo(kind)              // TODO: growth = KINDS[kind] or fail
```
