# Feature flag SDK: local overrides (extension round)

> PROVISIONAL (LLD practice batch 7c, Q-WD-30): drafted by Claude; the owner reviews it before launch.

During an incident, an operator needs to force a flag on or off in this process right
now, whatever the server says and whether or not it can be reached.

- `localOverride(flag, on)`: from now on, `evaluate` returns `on` for this flag and every
  user, ahead of the client's copy and the defaults. Overriding the same flag again
  replaces the value. The flag needn't be known anywhere: an override makes `evaluate`
  answer for a flag that would otherwise fail. An empty flag fails.
  - `evaluate` still fails on an empty user.
  - Overrides are local: syncing never clears them, and `staleMs` ignores them.
