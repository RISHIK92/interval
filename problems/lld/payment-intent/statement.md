# Payment intent

> PROVISIONAL (LLD practice batch 8d, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A payment intent tracks one payment through its life. It starts awaiting payment, moves to
processing when the customer confirms, and the payment network then settles it as
succeeded or failed. A succeeded payment is captured, in one go or in parts, and captured
money can be refunded. Each status permits only its own operations, and everything else is
refused.

| Status               | Permits                                                                      |
| -------------------- | ---------------------------------------------------------------------------- |
| `"awaiting_payment"` | `confirm`: moves to `"processing"`                                           |
| `"processing"`       | `confirm` again (changes nothing); `settle`: to `"succeeded"` or `"failed"`  |
| `"succeeded"`        | `settle(true)` again (changes nothing); `capture`; `refund`: to `"refunded"` |
| `"failed"`           | `settle(false)` again (changes nothing)                                      |
| `"refunded"`         | `refund`                                                                     |

- `PaymentIntent(amountCents)`: a payment of `amountCents`, awaiting payment, with nothing
  captured or refunded.
- `confirm()`, `settle(succeeded)`: return `true` when the status permits the call, as in
  the table, and `false` otherwise. Repeating the call that moved the payment into its
  current status (with the same `succeeded`) is a safe retry: it returns `true` and changes
  nothing. `settle` with the other outcome is refused.
- `capture(cents)`: captures `cents` more. Refused when the status doesn't permit it or when
  the total captured would pass `amountCents`. Captures may be partial and repeated.
- `refund(cents)`: gives back `cents` of the captured money. Refused when the status doesn't
  permit it or when the total refunded would pass the total captured. The first refund
  moves the payment to `"refunded"`, which permits only more refunds: nothing more can be
  captured.
- `status()`: the current status, as in the table.

Every `cents` and `amountCents` is from 1 to 10^9, or the call fails, whatever the status:
a call fails before it's refused. A call that fails or is refused changes nothing. There
are at most 10^4 calls.

For example, `PaymentIntent(1000)`, then `confirm()`, `settle(true)`, `capture(600)` and
`refund(200)` all return `true`, after which `refund(500)` returns `false` (only 400 is
left to refund) and `status()` returns `"refunded"`.
