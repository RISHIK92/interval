# Deploy facade: dry runs (extension round)

> PROVISIONAL (LLD practice batch 7a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Before a risky release, people want to see what a deploy would do without doing it.

- `dryRun(service, version)`: returns exactly what `deploy(service, version)` would return
  if it were called now, broken steps and undo lines included, and changes nothing: the
  history stays as it is, and a broken step stays broken. An empty service or version
  fails.
