# LRU cache: resizing and peeking (extension round)

> PROVISIONAL (P5-W31-S02c): written during the build; the owner reviews it before launch.

The cache's size can now change while it runs, and a key can be read without using it.

- `resize(capacity)`: sets a new capacity (at least 1, or the call fails and changes
  nothing). If more keys are cached than it allows, the least recently used ones are
  evicted until they fit.
- `peek(key)`: the key's value, or null, **without** making it the most recently used.
