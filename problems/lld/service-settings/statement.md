# Startup settings

> PROVISIONAL (LLD practice batch A4a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A service's settings are checked once, when they are built. Bad settings fail right there,
at startup, never hours later in the middle of a request. Once built, the settings are
always valid: no later call can make them invalid.

- `ServiceSettings(port, workers, timeoutMs)`: the settings. `port` must be from 1 to
  65535, `workers` from 1 to 64 and `timeoutMs` from 1 to 60000, all inclusive, or the
  constructor fails.
- `withWorkers(n)`: sets the worker count to `n` and returns true. When `n` is outside 1
  to 64 it returns false and nothing changes.
- `budgetMs(retries)`: the most time one request may take with `retries` retries: the
  timeout for the first try and for every retry, that is `timeoutMs * (retries + 1)`. Its
  precondition is that `retries` is from 0 to 10; any other value fails.
- `describe()`: the settings as `port=<port> workers=<workers> timeoutMs=<timeoutMs>`,
  for example `port=8080 workers=4 timeoutMs=3000`.

Every argument is an integer from -10^9 to 10^9. A call that fails changes nothing. There
are at most 10^4 calls.
