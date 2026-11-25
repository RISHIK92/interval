# Connection lifecycle: reconnecting (extension round)

> PROVISIONAL (LLD practice batch A1, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A failed connection can now be brought back. `failed` is no longer final; `closed` still is.

- `reconnect()`: moves a `failed` connection to `open` and returns true. From any other
  state it's refused: it returns false and changes nothing.
- `attempts()`: how many times `reconnect()` has moved this connection to `open`; refused
  calls don't count. 0 for a new connection.
- A reconnected connection is `open` like any other: it can be disconnected, or fail again
  and be reconnected again.
