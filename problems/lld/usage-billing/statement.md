# Usage-based billing

> PROVISIONAL (LLD practice batch A2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build the billing for metered usage. Each metric (API calls, gigabytes stored) has a price
made of tiers and a pricing model, customers report how many units they used, and an
invoice charges each customer per metric.

**Tiers** are a list of 1 to 10 pairs `[start, centsPerUnit]`. The first tier starts at 0,
each start is greater than the one before, and no start is above 10^9; each rate is from 0
to 10^6 cents. A tier covers the units after its start, up to and including the next
tier's start; the last tier has no end. With `[[0, 10], [100, 8], [1000, 5]]`, units 1 to
100 are in the first tier, 101 to 1000 in the second, and every unit after 1000 in the
third. Any other list (empty, a pair that isn't two numbers, a first start that isn't 0,
starts that don't rise, a rate out of range) is refused.

There are two **pricing models**:

| Model         | How `units` are charged                                                         | 150 units with the tiers above |
| ------------- | ------------------------------------------------------------------------------- | ------------------------------ |
| `"graduated"` | each unit at the rate of the tier it falls in                                   | 100 × 10 + 50 × 8 = 1400       |
| `"volume"`    | every unit at the rate of the tier the last unit falls in (100 units: 100 × 10) | 150 × 8 = 1200                 |

- `UsageBilling()`: no metrics, no usage.
- `price(metric, model, tiers)`: prices the metric. An empty metric name, an unknown model
  (case matters) or refused tiers fails. Pricing a metric again replaces its pricing, and
  invoices always use the current pricing.
- `meter(customer, metric, units)`: adds `units` to what the customer has used of the
  metric. An empty customer, a metric that hasn't been priced, or `units` outside 1 to 10^9
  fails.
- `invoice(customer)`: for each metric the customer has used, the charge in cents for all
  the units they have used of it. A customer who hasn't used anything gets an empty map.
- `total(customer)`: the sum of the customer's invoice, 0 when it's empty.

A failed call changes nothing. The calls keep each customer's units of one metric at most
10^9, and every charge and total below 2^53.
