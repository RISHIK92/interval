# Log template interning: purging (extension round)

> PROVISIONAL (LLD practice batch 7c, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A noisy pattern is flooding the store, and nobody needs its events any more.

- `purge(pattern)`: drops the pattern and every event that uses it, and returns how many
  events it dropped: 0, changing nothing, when no event uses it. An empty pattern fails.
  - A dropped event's id fails in `render` from then on, and is never handed out again:
    ids keep counting from where they were.
  - The pattern no longer counts in `templates()`. Logging it again stores it again.
