> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

Two routes match `/api/users/7`; why is the one with the longest prefix always the right one to pick?

## Approach

Give each concern a small object and let the gateway be the only thing that knows the order. A scripted service holds its status list and a cursor that stops at the last entry. A route holds its service name, its auth flag, its ttl and its own map from path to cached status and expiry time, so re-routing or a new, longer route never serves another route's responses. A request picks the longest matching prefix, checks auth, then consults the route's cache, and only then forwards to the service, writing a 200 back into the cache with `now + ttl`. Each early exit returns its own fixed triple.

## Code sketch

```text
class ScriptedService
  statuses, served = 0
  answer() -> int      // TODO: statuses[min(served, last)]; served += 1

class Route
  service, auth = false, ttl = 0
  cached: map path -> (status, expires)

class Gateway
  routes: map prefix -> Route
  services: map name -> ScriptedService

  route(prefix, service)          // TODO: new Route, or swap service + clear cache
  requireAuth(prefix)             // TODO
  cache(prefix, ttlMs)            // TODO
  upstream(service, statuses)     // TODO: validate, replace
  request(path, token, nowMs) -> [status, service, cache]
    // TODO: longest matching prefix, else 404
    // TODO: auth, then cache hit, then 502 if unscripted
    // TODO: answer; cache a 200 when the route caches
```
