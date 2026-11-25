# Process-wide settings: scoped views (extension round)

> PROVISIONAL (LLD practice batch 6a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

The database client only cares about its own settings and should get them in one call.

- `scoped(prefix)`: every setting whose key starts with `prefix`, as a map from the full
  key to the value `value(key)` would give, overrides included. It is a copy: changing the
  holder later doesn't change a map already returned. Like `value`, it loads the settings
  first if they aren't loaded.
- An empty `prefix` fails, and then nothing is loaded.
