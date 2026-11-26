> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If every check could only say "this is my verdict" or "not mine, ask the next one", what would `assess` have to know about the kinds of check in its chain?

## Approach

Make each check a small object with one operation: look at the payment and return a verdict, or nothing to pass it on. The four kinds differ only in that operation and the param they keep. What they look at besides the payment (the blocklist, each customer's home country and recent payment times) lives in one shared history, which the chain updates for every payment before any check runs, so the order of checks never changes what the history says. `assess` walks the list in order and stops at the first verdict, falling back to allow, and counts the verdict. A customer's recent times only grow at the end and only expire at the front, so dropping the expired ones keeps the velocity count a length.

## Code sketch

```text
class Check
  param
  decide(payment, history) -> verdict or none     // one per kind

class History
  blocked: set, home: map customer -> country
  recent: map customer -> queue of times
  remember(payment)    // TODO: first country; push time; drop expired

class RiskChain
  checks: list of Check
  history, counts: map verdict -> int

  addCheck(check, param)    // TODO: validate kind and param, append
  block(customer)           // TODO
  assess(customer, cents, country, nowMs) -> verdict
    // TODO: validate, history.remember(payment)
    // TODO: first decide() that isn't none, else "allow"; count it
  decisions(verdict) -> int
```
