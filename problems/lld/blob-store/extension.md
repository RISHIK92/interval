# Swappable blob store: older versions (extension round)

> PROVISIONAL (LLD practice batch C2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Support asks to see what a blob used to be. Both backends answer, each with what it keeps.

- `fetchVersion(key, version)`: the blob the key had at that version, or null when the
  backend doesn't have it: the key isn't held, the version is above the latest, or (on
  `"plain"`, which keeps only the latest blob) it isn't the latest. A version below 1 or an
  empty key fails.
- Versions count as in `putBlob`: after a remove, or a migration, a key's versions start
  again at 1.
