# API gateway

> PROVISIONAL (LLD practice batch 7c, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Clients send every request to one gateway. It picks the upstream service by the path's
longest matching prefix, turns away requests without a token on routes that need one, and
answers repeated requests from its cache, so clients never deal with routing, auth or
caching themselves. Upstream services are scripted fakes.

**Paths and prefixes.** A path starts with `/`. A prefix is a path too, and only the prefix
`/` may end with `/`. A prefix matches a path when it is `/` (which matches every path),
equals the path, or is followed in the path by `/`: `/api` matches `/api` and `/api/users`
but not `/apiary`. A path or prefix that breaks these rules fails, in every call.

- `Gateway()`: no routes and no services.
- `route(prefix, service)`: requests matching `prefix` go to `service`. Routing a prefix
  that's already routed changes its service and empties its cache (even when the service is the same), keeping its settings.
  An empty service fails.
- `requireAuth(prefix)`: the route turns away requests with an empty token from now on.
- `cache(prefix, ttlMs)`: the route caches its responses for `ttlMs` (at least 1, or it
  fails) from now on. Calling it again sets the ttl for responses cached later; responses
  already cached keep their expiry. `requireAuth` and `cache` fail on a prefix that isn't
  routed.
- `upstream(service, statuses)`: scripts the service: it answers the requests forwarded to
  it with these statuses in order, then keeps answering with the last one. Scripting it
  again starts the new list from its beginning. Each status is from 100 to 599, and an
  empty list or an empty service fails. A service may be scripted before it's routed to.
- `request(path, token, nowMs)`: returns `[status, service, cache]`: the status as a
  decimal string, the service that answered, and `"hit"`, `"miss"` or `"-"`. In order:
  1. The route is the one with the longest matching prefix. With none, `["404", "-", "-"]`.
  2. If the route requires auth and the token is empty: `["401", "-", "-"]`. Any other
     token passes: checking its content is the service's business.
  3. If the route caches and has a response for exactly this path that hasn't expired:
     `[<its status>, <service>, "hit"]`. A response cached at time `t` serves requests with
     `nowMs < t + ttlMs`.
  4. If the route's service isn't scripted: `["502", "-", "-"]`.
  5. Otherwise the service answers with its next status. On a route that caches, the
     result ends with `"miss"` whatever the status, and only a `200` is cached for this
     path (replacing an expired one). On a route that doesn't cache, it ends with `"-"`.
     Routes that share a service share its script: each forwarded request takes the next
     status.

A call that fails changes nothing. The token is the one string that may be empty. Names
and paths are printable ASCII and case-sensitive. `0 <= nowMs <= 10^12` and never
decreases from one request to the next, `ttlMs <= 10^9`, a script has at most 100
statuses, and there are at most 10^4 calls.

For example, with `/api` routed to `core` and `/api/users` to `users`, both scripted
`[200]`, `request("/api/users/7", "", 0)` returns `["200", "users", "-"]` and
`request("/apiary", "", 0)` returns `["404", "-", "-"]`.
