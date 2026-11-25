> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If every layer and the transport answered the same question, "a call for this path starting at time t: what status, and how long did it take?", what would a layer need to know about the one below it?

## Approach

Give every layer and the transport one method, call(path, t) returning a status and a duration, and let each layer hold a reference to the layer below; wrapping replaces the top with a new layer around the old top. The transport pops the path's next scripted pair and counts the call. Retry loops over attempts, adding each attempt's duration and the doubling waits to a running total, and calls below at `t` plus that total. Cache remembers when a path's 200 arrived and answers from memory inside its window. Breaker counts failures in a row and remembers when it opened. The client only records the top call's duration.

## Code sketch

```text
interface Layer
  call(path, t) -> (status, took)

class Transport implements Layer      // scripts, calls
  call(path, t)          // TODO: next pair of the path's script; calls += 1

class Retry(inner, retries) implements Layer
  call(path, t)          // TODO: attempts, waits 100, 200, 400...; total time
class Cache(inner, ttl) implements Layer
  call(path, t)          // TODO: arrived <= t < arrived + ttl -> (200, 0)
class Breaker(inner, threshold) implements Layer
  call(path, t)          // TODO: open window -> (503, 0); count failures

class ClientStack
  transport, top = transport, elapsed = 0
  script(path, statuses, latenciesMs)   // TODO: validate, replace
  wrap(layer, param)                    // TODO: top = Layer(top, param)
  fetch(path, nowMs) -> status          // TODO: top.call; remember took
  upstreamCalls(), elapsedMs()
```
