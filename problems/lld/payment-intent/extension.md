# Payment intent: disputes (extension round)

> PROVISIONAL (LLD practice batch 8d, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Customers can now dispute a charge with their bank. A dispute freezes the payment until the
bank decides, so nothing more happens to it here.

- `dispute(cents)`: the customer disputes `cents` of the money still held (the total
  captured minus the total refunded). It's permitted only in `"succeeded"` and
  `"refunded"`, and it's refused when `cents` is more than that money. A permitted dispute
  returns `true` and moves the payment to a new status, `"disputed"`, which permits
  nothing: every later `confirm`, `settle`, `capture`, `refund` and `dispute` is refused.
- `cents` is from 1 to 10^9, or the call fails, as in the base round.
