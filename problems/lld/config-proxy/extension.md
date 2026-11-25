# Read-through config proxy: invalidation (extension round)

> PROVISIONAL (LLD practice batch 7a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

When someone changes a setting on purpose, waiting out the TTL is too slow.

- `invalidate(key)`: drops the proxy's copy of the key, fresh or stale, so the next read
  fetches. With no copy left, a read while the upstream is down returns null. A key with
  no copy is fine: nothing changes. An empty key fails.
