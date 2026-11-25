> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If the invoice code is one function that does the arithmetic for all four steps at once, where would a new step that sits between two of them go?

## Approach

Keep each customer's running figures (usage, credit balance, tax rate) together, and build an invoice as a draft that passes through one small function per step, each filling in its own figure: subtotal, credits used, exact tax, rounded tax. To avoid fractions, keep the rate in basis points so the exact tax is a whole number of ten-thousandths of a cent, and let the rounding step alone turn it into cents. After the steps, the run resets the usage and takes the used credit out of the balance.

## Code sketch

```text
RATES: map region -> basis points   // us 725, eu 2100, jp 1000

class InvoiceRun
  accounts: map customer -> (usage, balance, rate)

  usage(customer, cents) / credit(customer, cents)
    // TODO: fail on an empty name or cents outside 1..10^7
    // TODO: add to usage / balance (creating the account)
  region(customer, region)
    // TODO: fail on an unknown region; set the rate
  invoice(customer) -> list
    // TODO: fail if the customer doesn't exist
    // TODO: subtotal step
    // TODO: credits step: the smaller of balance and subtotal
    // TODO: tax step: (subtotal - credits) * rate
    // TODO: rounding step: to cents, half up
    // TODO: reset usage, reduce balance; return the four figures
  carryOver(customer) -> int
```
