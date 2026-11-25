> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

The two models read the same tiers and answer the same question, "what do these units cost?". What if each model were its own object that the billing class only asks that question?

## Approach

Give each pricing model one small interface, `charge(units)`, and one class per model that holds the validated tiers. Validate tiers once, in a shared function, when a metric is priced; the billing class maps a metric to its pricing object and never asks which model it is. Usage is a map from customer to a map from metric to units, so an invoice charges each metric on the customer's total units. For graduated, walk the tiers and charge the units that fall inside each one; for volume, find the tier holding the last unit and charge every unit at its rate.

## Code sketch

```text
interface Pricing
  charge(units) -> int

checkedTiers(tiers) -> list of (start, rate)
  // TODO: 1-10 pairs; first start 0, rising, <= 10^9; rates 0-10^6

class Graduated(tiers) implements Pricing
  // TODO: for each tier, units inside it times its rate
class Volume(tiers) implements Pricing
  // TODO: units times the rate of the last tier whose start < units

class UsageBilling
  pricing: map metric -> Pricing
  usage: map customer -> map metric -> units

  price(metric, model, tiers)
    // TODO: fail on an empty metric or unknown model; replace the pricing
  meter(customer, metric, units)
    // TODO: fail on bad input or an unpriced metric; add the units
  invoice(customer) -> map metric -> cents
    // TODO: pricing[metric].charge(units) for each metric used
  total(customer) -> int
```
