# Layered config: renamed settings (extension round)

> PROVISIONAL (LLD practice batch A4a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A setting has been renamed, but some sources still use its old name.

- `alias(oldKey, newKey)`: from now on, `oldKey` and `newKey` are one setting. Looking up
  either key (with `lookup`, `origin` or `intValue`) gives the same answer: precedence
  between sources still decides, so a flag under the old name beats a file under the new
  one. Within a single source that has both keys, the value under `newKey` wins.
- A key can be part of at most one alias, as either name. Aliasing a key that already is
  one fails, and so do two equal keys or an empty one.
