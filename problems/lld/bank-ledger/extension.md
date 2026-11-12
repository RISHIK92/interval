# Bank ledger: frozen accounts (extension round)

> PROVISIONAL (P5-W31-S02c): written during the build; the owner reviews it before launch.

Accounts can now be frozen, for review.

- `freeze(account)`: from now on, `withdraw` from the account fails, and so does any
  `transfer` from it or to it. Deposits still work. Freezing a frozen account changes
  nothing.
- `unfreeze(account)`: lifts the freeze (nothing changes if it wasn't frozen).
- `isFrozen(account)`: whether it is frozen.

All three fail for an unknown account. A call that fails for any reason changes
nothing; an invalid call fails even when the balance wouldn't cover the amount.
