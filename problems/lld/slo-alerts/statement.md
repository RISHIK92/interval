# SLO burn alerts

> PROVISIONAL (LLD practice batch 8b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A service's objective says what share of its requests must succeed. An objective of 990
permille (99%) leaves an **error budget** of 10 failed requests in every 1000. Teams want
to hear when a service has burned through a given share of its budget, and again when it
has recovered, without being told the same thing on every update.

For a service with `good` and `bad` requests so far (counted since it was first seen), the
**burn** is the share of the budget spent, as a whole percentage rounded down:

```text
burn = floor(bad * 1000 * 100 / ((good + bad) * (1000 - objectivePermille)))
```

and 0 while `good + bad` is 0. It may go above 100.

- `SloMonitor(objectivePermille)`: one objective for every service. Outside 1 to 999, it
  fails.
- `watch(subscriber, service, burnPercent)`: the subscriber watches the service at a
  threshold from 1 to 100; any other threshold fails. A watcher is **burning** while the
  service's burn is at least its threshold. A new watcher starts as not burning, even if
  the service is already over its threshold. Watching a service it already watches
  replaces the threshold, keeping its place in the order and whether it is burning.
- `observe(service, good, bad)`: adds the counts to the service, then checks its watchers
  in the order they started watching it. Each watcher whose burning state flips is told
  once: `"<subscriber> burning"` or `"<subscriber> recovered"`. Returns those messages in
  that order, `[]` when nobody's state changed. A negative count fails.
- `budgetLeft(service)`: `100 - burn`. A service never observed has burned nothing.

An empty subscriber or service fails, in every call, and a call that fails changes
nothing. Names are printable ASCII and case-sensitive. Each count is at most 10^6, and
there are at most 10^4 calls.

For example, with an objective of 990 and `"pager"` watching `"api"` at 50,
`observe("api", 995, 5)` returns `["pager burning"]` and `budgetLeft("api")` returns 50.
After `observe("api", 3000, 0)` the burn is 12, so it returns `["pager recovered"]`.
