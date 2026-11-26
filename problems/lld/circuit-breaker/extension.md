# Circuit breaker: manual override (extension round)

> PROVISIONAL (LLD practice batch 8a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

During an incident, an operator needs to stop all traffic to the dependency by hand, and
to let it flow again when they're done.

- `forceOpen(on)`: with `on` true, the breaker is held open: `allow` returns false,
  `success` and `failure` change nothing, there's no cool-down, and `state` says
  `"open"`, until it's released. With `on` false, a held breaker is released and is
  closed, with no failures counted.
  - Holding a breaker that's already held, or releasing one that isn't held, changes
    nothing. A breaker that opened by itself isn't held.
  - `forceOpen` takes no time, and calls after it follow the rules for `nowMs` as before.
