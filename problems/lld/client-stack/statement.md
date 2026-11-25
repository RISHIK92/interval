# HTTP client layers

> PROVISIONAL (LLD practice batch 7c, Q-WD-30): drafted by Claude; the owner reviews it before launch.

An HTTP client is built from layers around a transport: retries with backoff, a response
cache, a circuit breaker. Each layer wraps whatever is below it, and the order of the
wrapping changes the result: a cache outside an open breaker still answers, a cache
inside it can't. Here the transport is a fake that answers from a script, and time is
simulated, so every result is exact.

**Calls and time.** Every layer, and the transport, handles a call: a request for a path
that starts at time `t`, answered with a status and the milliseconds it took. A status of
500 or more is a **failure**.

- `ClientStack()`: just the transport, with nothing scripted.
- `script(path, statuses, latenciesMs)`: the transport answers the path's calls with
  these statuses in order, each taking the latency at the same position, then keeps
  answering with the last pair. Scripting a path again starts its new list from the
  beginning. The lists must be the same length and not empty, each status from 100 to
  599 and each latency at least 0, and the path not empty, or it fails.
- `wrap(layer, param)`: puts a new layer outside all the ones already there:
  - `"retry"`, `param` from 1 to 5: calls the layer below at `t`. While the answer is a
    failure and fewer than `param` retries have been made, it waits and calls again: the
    first retry waits 100 ms, and each later one waits twice as long as the one before.
    Each call starts when the previous call and the wait after it end. Its answer is the
    last call's status, and the time from `t` until that call ended, waits included.
  - `"cache"`, `param` = a ttl of at least 1 ms: keeps, per path, when the last `200` it
    handled from below arrived (`t` plus the time the call took), even if an earlier one
    arrived later. A call at a time in
    `[arrived, arrived + ttl)` is answered `200` in 0 ms without calling below. Other
    statuses are never kept.
  - `"breaker"`, `param` = a threshold of at least 1: counts failures in a row from below,
    for all paths together; any non-failure resets the count to 0. When the count reaches
    the threshold, the breaker opens at the time that failure arrived, and calls starting
    within `[opened, opened + 1000)` are answered `503` in 0 ms without calling below
    (they don't count as failures it saw). After that it lets calls through again, but
    until a non-failure resets it, one more failure reopens it. A non-failure resets the
    count but never shortens a window already set.

  Any other layer, or a param out of range, fails. Every `param` is at most 10^9.

- `fetch(path, nowMs)`: makes a call at `nowMs` to the outermost layer and returns its
  status. A path that was never scripted fails.
- `upstreamCalls()`: how many calls reached the transport, over the client's life.
- `elapsedMs()`: how long the last fetch took, by the simulated clock; 0 before any fetch.

Each layer keeps its own state for the client's whole life. Calls are handled one after
another, in the order they're made, whatever times they carry. A call that fails changes
nothing. Layer names and paths are case-sensitive printable ASCII. `0 <= nowMs <= 10^9`,
latencies are at most 10^6, there are at most 6 layers, no fetch makes more than 1000
calls to the transport, and there are at most 10^4 calls.

For example, with `/a` scripted `[503, 503, 200]` at 10 ms each under `wrap("retry", 2)`,
`fetch("/a", 0)` returns `200` after three transport calls: the first ends at 10, the
second starts at 110 and ends at 120, the third starts at 320. `elapsedMs()` is `330`.
