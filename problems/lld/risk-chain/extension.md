# Payment risk checks: trusted customers (extension round)

> PROVISIONAL (LLD practice batch 8c, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Some customers are trusted: a long-standing merchant shouldn't be sent to review for a
burst of payments. Their payments skip some kinds of check.

- `skipFor(customer, check)`: from now on, every check of this kind in the chain passes
  this customer's payments on without deciding, including checks of that kind added
  later. Returns `false` if the customer already skips that kind, and `true` otherwise.
  An empty customer or a kind other than the four fails.
  - The other kinds still run for the customer, in their order.
  - Skipping changes only who decides: every payment still counts towards velocity and
    home country as before.
