# Pluggable eviction: pinned keys (extension round)

> PROVISIONAL (LLD practice batch 8b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Some keys, such as a service's own configuration, must stay cached however rarely they
are read.

- `pinKey(key)`: the cached key is never evicted from now on, under any policy: each
  eviction picks from the unpinned keys only. Pinning a pinned key changes nothing. A key
  that isn't cached, or is empty, fails.
  - A pinned key still counts toward the capacity, and `put` and `lookup` still use it.
  - When the cache is full and every cached key is pinned, a `put` of a new key fails.
    Updating a cached key still works.
