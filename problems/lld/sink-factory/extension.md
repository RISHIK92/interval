# Log sink factory: buffered sinks (extension round)

> PROVISIONAL (LLD practice batch 6a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Some services log in bursts and want lines held in memory until they choose to send them.
That's a new kind of sink, `buffered`, with its own way of being made.

- `createBuffered(capacity)`: makes a new buffered sink that holds up to `capacity` lines
  and returns its id, numbered like any other kind (`buffered-1`, `buffered-2`, ...). A
  capacity below 1 or above 1000 fails.
- `writeLine` on a buffered sink holds the line and returns an empty string, since
  nothing is written yet. When the sink already holds `capacity` lines, the oldest one is
  dropped to make room.
- `flush(sink)`: the lines the buffered sink holds, oldest first, and empties it. An
  unknown sink, or a sink of another kind, fails.
- `kindOf` gives `buffered` and `created("buffered")` counts these sinks. `create` still
  has no spec for them.
