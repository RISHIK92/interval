> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

What should the proxy remember about each value besides the value itself?

## Approach

Model the upstream as its own small class: a map of values, a down flag, and a counter it bumps on every fetch, failing the fetch while down. The proxy holds one, plus a cache from key to the value and the time it was fetched. A read first checks the cache against the TTL; only a missing or stale copy leads to a fetch. A successful fetch that finds the key replaces the cache entry; one that finds nothing caches nothing. A failed fetch falls back to whatever copy is there, without touching its time.

## Code sketch

```text
class ConfigService
  values: map, down = false, calls = 0
  fetch(key) -> optional
    // TODO: count the call; fail while down

record Entry(value, fetchedMs)

class ConfigProxy
  ttl, upstream = ConfigService(), cache: map key -> Entry

  constructor(ttlMs)            // TODO: 1..10^9
  upstreamSet(key, val)         // TODO: fail on ""; upstream only
  read(key, nowMs) -> optional
    // TODO: fail on ""; fresh copy -> return it
    // TODO: fetch; on failure -> the stale copy or null
    // TODO: found -> keep Entry(value, nowMs)
  upstreamDown(down)
  upstreamFetches() -> upstream.calls
```
