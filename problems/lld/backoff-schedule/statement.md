# Backoff schedule

> PROVISIONAL (LLD practice batch A4a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A client retries a failed call after a delay that grows with each attempt, up to a cap.
Schedules differ only in how the delay grows; capping, listing and totalling are the same
for every kind.

The delay before attempt `n` (counting from 1), before the cap, is:

- `fixed`: `baseMs` every time.
- `linear`: `baseMs * n`.
- `exponential`: `baseMs * 2^(n-1)`.

The delay is that value or `capMs`, whichever is smaller. For example, `exponential` with
`baseMs` 100 and `capMs` 1000 gives 100, 200, 400, 800, 1000, 1000, ...

- `BackoffSchedule(kind, baseMs, capMs)`: a schedule of that kind. An unknown kind fails,
  and so do any values not meeting `1 <= baseMs <= capMs <= 10^9`.
- `delay(attempt)`: the delay before that attempt. `attempt` must be from 1 to 1000, or
  the call fails.
- `schedule(attempts)`: the delays before attempts 1 to `attempts`, in order (an empty
  list for 0). `attempts` must be from 0 to 1000, or the call fails.
- `totalMs(attempts)`: the sum of `schedule(attempts)`, with the same bounds.
- `switchTo(kind)`: from now on the schedule grows the given way, keeping its `baseMs`
  and `capMs`. An unknown kind fails.

Kinds are exactly `fixed`, `linear` and `exponential`, case-sensitive. A call that fails
changes nothing. Every integer argument is from -10^9 to 10^9 (so totals are at most
10^12), and there are at most 10^4 calls.
