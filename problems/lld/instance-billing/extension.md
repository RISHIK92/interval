# Instance billing: dedicated hosts (extension round)

> PROVISIONAL (LLD practice batch A2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Some customers need hardware of their own, so there's a fourth kind of instance.

- `launchDedicated(id, hourlyCents, hostFeeCents)`: adds a dedicated instance that has
  run 0 hours. The id and `hourlyCents` follow `launch`'s rules; `hostFeeCents` outside 0
  to 10^6 fails. A failed call changes nothing.
- A dedicated host is set aside for each run, so a dedicated instance costs `h × r` plus
  `hostFeeCents` for every `run` call that succeeded: running 3 hours once costs one fee,
  and running 1 hour three times costs three.
- `run`, `bill` and `total` treat a dedicated instance like any other, and `interrupt`
  fails on one, as on every kind but spot.
- `launch` still fails for the kind `"dedicated"`: dedicated instances are added only
  through `launchDedicated`.
