# Payment risk checks

> PROVISIONAL (LLD practice batch 8c, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A payment provider runs every payment through a chain of risk checks. Each check looks at
the payment and either decides it (sends it to `"review"` or `"block"`s it) or passes it
on to the next check. The first check that decides wins, and a payment that every check
passes on is `"allow"`ed. The checks run in the order they were added, so the same checks
in a different order can give a different verdict.

- `RiskChain()`: no checks, no blocked customers, no payments.
- `addCheck(check, param)`: adds a check of this kind to the end of the chain. A kind may
  be added more than once. The kinds:
  - `"blocklist"`: blocks the payment if its customer is blocked. `param` must be `0`.
  - `"velocity"`: sends the payment to review if its customer has made more than `param`
    payments in the last minute, this one included: the payments with
    `nowMs - 60000 < t <= nowMs`. `param` must be at least 1.
  - `"amount"`: blocks the payment if `cents > param`. `param` must be at least 0.
  - `"country"`: sends the payment to review if its country isn't its customer's home
    country: the country of the customer's first payment. `param` must be `0`.

  An unknown kind or a `param` it doesn't accept fails.

- `block(customer)`: puts the customer on the blocklist. Blocking a blocked customer
  changes nothing.
- `assess(customer, cents, country, nowMs)`: runs the payment through the chain and
  returns the verdict. `cents` below 1 fails. Every payment assessed counts, whatever the
  verdict and whichever checks ran: it counts towards its customer's velocity, and a
  customer's first payment sets their home country, even when the chain has no velocity
  or country check yet.
- `decisions(verdict)`: how many payments have been given this verdict. A verdict other
  than the three fails.

Customers and countries are printable ASCII and case-sensitive, and an empty one fails. A
call that fails changes nothing. `0 <= nowMs <= 10^12` and never decreases from one
payment to the next, `cents` and `param` are at most `10^12`, and there are at most 10^4
calls.

For example, with the chain `blocklist`, `velocity 2`, `amount 50000`, a third payment
from one customer within a minute is sent to review even if it is over the amount limit,
because the velocity check comes first.
