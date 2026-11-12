# Rate limiter

> PROVISIONAL (P5-W30-S03): written during the build; the owner reviews it before launch.

Build a sliding-window rate limiter: each client may make at most `limit` allowed
requests in any window of `windowMs` milliseconds.

- `RateLimiter(limit, windowMs)`: both are at least 1, or the constructor fails.
- `allow(client, nowMs)`: true when the client has fewer than `limit` allowed requests in
  the window `(nowMs - windowMs, nowMs]`; the request is then recorded at `nowMs`. A
  refused request is not recorded.
- `remaining(client, nowMs)`: how many more requests the client could make at `nowMs`.
  It records no request, but it is still a call, so it sets the client's time.
- Time never runs backwards for a client: a call with a `nowMs` earlier than that
  client's previous call fails and changes nothing. Clients are independent.

Times are integers, negative ones too, within ±2^53. Several threads may call at once
(JavaScript and TypeScript: interleaved async calls). Every completed call must count.
