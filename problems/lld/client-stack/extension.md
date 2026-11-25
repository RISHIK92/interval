# HTTP client layers: hedging (extension round)

> PROVISIONAL (LLD practice batch 7c, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Tail latency hurts: one slow upstream answer in a hundred makes a whole page slow. A
hedged request sends a second copy when the first is slow and takes whichever answers
first.

- `hedge(afterMs)`: puts a hedge layer outside all the layers already there, like `wrap`.
  `afterMs` is at least 0, or it fails, and at most 10^9. (`hedge` isn't
  a `wrap` layer: `wrap("hedge", n)` still fails.) For a call at `t`:
  - It calls the layer below at `t`. If that took at most `afterMs`, that's its answer.
  - Otherwise it calls the layer below a second time, at `t + afterMs`. The second
    answer wins if it ended strictly earlier, at `afterMs` plus its own time; a tie goes
    to the first. The answer is the winner's status and the time from `t` until the
    winner ended.
  - Both calls go all the way through the layers below, in that order (the first one in
    full before the second), so both count in `upstreamCalls()` and both can change the
    state of the layers below, such as a cache or a breaker.
