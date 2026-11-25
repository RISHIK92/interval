> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If the constructor accepted any numbers, when would a bad port be found out, and where could every rule be checked so the object is never invalid?

## Approach

Check every precondition in the constructor, before storing anything, and fail on the first one broken: the object then either exists and is valid or doesn't exist at all. Give each rule one home (a small `validWorkers` check, used by both the constructor and `withWorkers`), so the startup rule and the change rule can't drift apart. `withWorkers` refuses instead of failing because the running service must stay up; it checks first and only then assigns. `budgetMs` states its own precondition on `retries` and fails when it's broken, then computes from the stored timeout.

## Code sketch

```text
validWorkers(n) -> bool        // TODO: 1 <= n <= 64

class ServiceSettings
  port, workers, timeoutMs

  constructor(port, workers, timeoutMs)
    // TODO: fail unless 1 <= port <= 65535
    // TODO: fail unless validWorkers(workers)
    // TODO: fail unless 1 <= timeoutMs <= 60000
    // TODO: only now store them
  withWorkers(n) -> bool
    // TODO: false if not validWorkers(n); else set, true
  budgetMs(retries) -> int
    // TODO: fail unless 0 <= retries <= 10
    // TODO: timeoutMs * (retries + 1)
  describe() -> string
    // TODO: "port=.. workers=.. timeoutMs=.."
```
