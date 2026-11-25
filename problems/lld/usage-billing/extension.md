# Usage-based billing: minimum charges (extension round)

> PROVISIONAL (LLD practice batch A2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Some metrics now have a monthly minimum: a customer who uses the metric at all pays at
least that much for it.

- `minimum(metric, cents)`: sets the metric's minimum charge. A metric that hasn't been
  priced, or `cents` outside 0 to 10^9, fails and changes nothing. Setting it again
  replaces it, and pricing the metric again keeps it.
- In an invoice, a metric with a minimum is charged the greater of its usual charge and
  the minimum. A customer who hasn't used the metric isn't charged for it.
