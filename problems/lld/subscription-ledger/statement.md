# Event-sourced subscriptions

> PROVISIONAL (LLD practice batch 8d, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A billing service keeps subscriptions as event streams instead of rows. A command is checked
against the subscription's current state and, if it's allowed, stored as an event. The
state at any past moment is rebuilt by replaying events, and snapshots cut down how many
have to be replayed.

| Command   | `arg`                  | Allowed when the subscription is                         | Event       | Effect of the event                                             |
| --------- | ---------------------- | -------------------------------------------------------- | ----------- | --------------------------------------------------------------- |
| `create`  | tier, 1 to 100         | `none`                                                   | `created`   | active at that tier                                             |
| `upgrade` | tier, 1 to 100         | active and not paused, and `arg` is higher than its tier | `upgraded`  | the new tier                                                    |
| `pause`   | duration ms, 1 to 10^9 | active and not paused                                    | `paused`    | paused from the event's time `t` until `t + arg` (not included) |
| `cancel`  | 0                      | active, paused or not                                    | `cancelled` | cancelled, for good                                             |

A subscription's state at time `T` is written `"none"` before it's created (and for one
that never was), then `"active:<tier>"`, `"paused:<tier>"` (when a pause covers `T`) or
`"cancelled:<tier>"`.

- `SubscriptionLedger()`: no subscriptions, no snapshots.
- `handle(command, sub, arg, nowMs)`: returns `true` and stores the event at `nowMs` when
  the command is allowed on `sub`'s state at `nowMs`, and returns `false`, storing nothing,
  when it isn't. An unknown command (case matters), an `arg` outside its range, or a
  `nowMs` that's less than the last `handle` call's (or outside 0 to 10^12) fails. Checking
  a command uses the current state, which is kept up to date as events are stored: it
  doesn't replay.
- `events(sub)`: `sub`'s events, oldest first, as `"<nowMs>:<event>:<arg>"`:
  `"1000:created:2"`. A subscription without events gives `[]`.
- `stateAt(sub, nowMs)`: `sub`'s state at `nowMs` (0 to 10^12, or the call fails; any order), rebuilt by
  replay: start from the latest snapshot whose events all happened at or before `nowMs`
  (or from `"none"` without one), then apply, oldest first, each later event that
  happened at or before `nowMs`.
- `snapshotEvery(n)`: from now on, whenever a subscription's number of stored events
  becomes a multiple of `n`, a snapshot of its state after that event is kept. Snapshots
  already kept stay, and `n` outside 1 to 10^4 fails.
- `replays()`: how many events every `stateAt` so far has applied, in total.

Subscription names are printable ASCII and case-sensitive; an empty one fails. A
call that fails changes nothing. There are at most 10^4 calls.

For example, `handle("create", "acme", 2, 1000)`, `handle("pause", "acme", 500, 2000)`
and `handle("upgrade", "acme", 3, 2400)` return `true`, `true` and `false` (it's paused
until 2500). Then `stateAt("acme", 2499)` returns `"paused:2"`, `stateAt("acme", 999)`
returns `"none"`, and `replays()` returns 2.
