> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

When two threads move money between the same accounts at the same moment, what stops anyone from seeing a transfer half done?

## Approach

Keep a map from account to balance and guard the whole ledger with one lock: a transfer touches two accounts at once, and a single lock avoids the deadlock that per-account locks would need an ordering to prevent. Check every way a call can be invalid before looking at the balance, so a bad call fails even when the money wouldn't cover it; too little money is a plain `false`. The invariant: a transfer moves money but never changes the total.

## Code sketch

```text
class Bank
  accounts: map account -> balance
  lock: one lock for the whole ledger, held by every method

  open(account, balance)
    // TODO: reject a negative balance or an existing account; store it
  deposit(account, amount) -> int
    // TODO: validate; add; return the new balance
  withdraw(account, amount) -> bool
    // TODO: validate first; false (and no change) when the balance can't cover it
  transfer(source, target, amount) -> bool
    // TODO: validate the amount and both accounts before checking funds
    // TODO: change both balances under the same lock
  balance(account) -> int
    // TODO: the balance; an unknown account fails
  total() -> int
    // TODO: the sum of every balance
```
