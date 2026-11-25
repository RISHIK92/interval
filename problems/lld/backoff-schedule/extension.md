# Backoff schedule: Fibonacci growth (extension round)

> PROVISIONAL (LLD practice batch A4a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Some teams want delays that grow more gently than doubling.

- `fibonacci()`: from now on the schedule grows like the Fibonacci numbers: the delay before
  attempt `n`, before the cap, is `baseMs * F(n)`, where F(1) = F(2) = 1 and F(n) =
  F(n-1) + F(n-2). With `baseMs` 100 that is 100, 100, 200, 300, 500, 800, ... It keeps
  `baseMs` and `capMs`, and capping, `schedule` and `totalMs` work as for every other kind.
- `switchTo` still moves to `fixed`, `linear` or `exponential`. Fibonacci growth is reached
  only through `fibonacci()`: `switchTo("fibonacci")` and the constructor still fail on it.
