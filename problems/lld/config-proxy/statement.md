# Read-through config proxy

> PROVISIONAL (LLD practice batch 7a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Services read their settings from a config service that is slow and sometimes down. Build
a proxy that stands in front of it: it reads keys the same way, but keeps each value it
fetches for a while, so most reads never reach the upstream. When the upstream is down, a
stale value is served rather than nothing.

The proxy owns the upstream, so the methods also drive it. Time is a parameter: `nowMs`
is from 0 to 10^12 and never decreases from one call to the next.

- `ConfigProxy(ttlMs)`: an empty upstream, up, and an empty cache. `ttlMs` is how long a
  fetched value stays fresh; outside 1 to 10^9 fails.
- `upstreamSet(key, val)`: sets the key's value in the upstream. The cache doesn't change,
  so the proxy may keep serving the old value until its copy goes stale. An empty key or
  value fails.
- `read(key, nowMs)`: the key's value.
  - A copy fetched at time `t` is fresh while `nowMs - t < ttlMs`. A fresh copy is
    returned without calling the upstream.
  - Otherwise the proxy fetches from the upstream. When the upstream has the key, its value
    is kept (fetched at `nowMs`) and returned. When it doesn't, null is returned and
    nothing is kept, so the next read fetches again.
  - While the upstream is down, every fetch fails: the proxy returns its stale copy if it
    has one, or null, and the copy keeps its old fetch time.

  An empty key fails.

- `upstreamDown(down)`: takes the upstream down (true) or brings it back (false).
- `upstreamFetches()`: how many fetches the proxy has made, including those that failed
  while the upstream was down.

A call that fails changes nothing. Keys and values are printable ASCII and case-sensitive,
and there are at most 10^4 calls.

For example, with `ttlMs` 1000 and `"db.host"` set to `"10.0.0.1"`, reads at 0 and 500
return it with one fetch. After the upstream changes to `"10.0.0.2"`, a read at 999 still
returns `"10.0.0.1"`, and a read at 1000 fetches and returns `"10.0.0.2"`.
