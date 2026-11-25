# Connection lifecycle

> PROVISIONAL (LLD practice batch A1, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build a client connection that is always in exactly one of four states: `idle`, `open`,
`closed` or `failed`. It starts `idle`, and only these moves are legal:

| Call         | From             | To       |
| ------------ | ---------------- | -------- |
| `connect`    | `idle`           | `open`   |
| `disconnect` | `open`           | `closed` |
| `fail`       | `idle` or `open` | `failed` |

`closed` and `failed` are final: nothing moves a connection out of them. A call that isn't
a legal move from the current state is refused and changes nothing.

- `Connection(host)`: a new `idle` connection; an empty host fails.
- `connect()`: true if it moved the connection to `open`, false if it was refused.
- `disconnect()`: true if it moved the connection to `closed`, false if it was refused.
- `fail(reason)`: moves the connection to `failed` when that's legal, and otherwise does
  nothing. An empty `reason` fails the call, whatever the state, and changes nothing.
- `state()`: the current state's name: `"idle"`, `"open"`, `"closed"` or `"failed"`.
