> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If each status were its own object, what would an operation that status doesn't permit do by default?

## Approach

Make each status a small state object with one method per operation, and let the base state refuse everything, so each status overrides only what its row of the table permits. The payment intent is the context: it validates `cents` first (a bad amount fails in any status), then hands the call to its current state, which may change the intent's state and its captured and refunded totals. The safe retries are just overrides that return `true` without touching anything. One helper on the intent checks "no more than what's left to refund" so the two statuses that refund share it.

## Code sketch

```text
class State
  name
  confirm(intent) -> bool            // false
  settle(intent, succeeded) -> bool  // false
  capture(intent, cents) -> bool     // false
  refund(intent, cents) -> bool      // false

class AwaitingPayment extends State  // TODO: confirm -> processing
class Processing extends State       // TODO: confirm retry; settle
class Succeeded extends State        // TODO: settle(true) retry; capture; refund
class Failed extends State           // TODO: settle(false) retry
class Refunded extends State         // TODO: refund

class PaymentIntent
  amount, captured = 0, refunded = 0, state = AwaitingPayment
  confirm() -> bool                  // TODO: state.confirm(this)
  settle(succeeded) -> bool          // TODO
  capture(cents) -> bool             // TODO: check cents, then delegate
  refund(cents) -> bool              // TODO
  status() -> string                 // TODO: state.name
```
