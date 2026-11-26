# Deployment rollout

> PROVISIONAL (LLD practice batch 8b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A new version of a service goes out in stages: a canary takes 10% of the traffic, then
the rollout widens to 50%, then to 100%, and it's done. It can be paused and resumed on
the way, and aborted back to the old version. Each state allows only its own moves.

| State         | Traffic on the new version | `begin` | `advance` | `pause` | `resume`            | `abort`     |
| ------------- | -------------------------- | ------- | --------- | ------- | ------------------- | ----------- |
| `pending`     |                            | canary  |           |         |                     |             |
| `canary`      | 10%                        |         | rolling   | paused  |                     | rolled-back |
| `rolling`     | 50%                        |         | done      | paused  |                     | rolled-back |
| `paused`      | as when it paused          |         |           |         | the state it paused |             |
| `done`        | 100%                       |         |           |         |                     |             |
| `rolled-back` | 0%                         |         |           |         |                     |             |

- `Rollout(service)`: a pending rollout for the service. An empty service fails.
- `begin(version)`, `advance()`, `pause()`, `resume()`, `abort()`: each makes its move
  from the table and returns true. A move the current state doesn't allow (an empty
  cell) returns false and changes nothing. `begin` also records the version being rolled
  out; an empty version fails, in every state.
- `status()`: `"<service> pending"` before `begin`. After it,
  `"<service> <state> <version> <traffic>%"`, for example `"api paused v2 50%"`.

`done` and `rolled-back` allow nothing: a new version needs a new rollout. Failing comes
before returning false, and a call that fails changes nothing. Names and versions are
printable ASCII, kept exactly as given, and there are at most 10^4 calls.

For example, for `"api"`: `advance()` returns false, `begin("v2")` returns true and
`status()` returns `"api canary v2 10%"`. After `advance()` and `pause()`, `advance()`
returns false and `status()` returns `"api paused v2 50%"`.
