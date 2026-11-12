# Bank ledger

> PROVISIONAL (P5-W30-S04): written during the build; the owner reviews it before launch.

Build a ledger of accounts that moves money without ever creating or losing any.

- `Bank()`: starts with no accounts.
- `open(account, balance)`: a new account with an opening balance of 0 or more. Opening an
  account that exists, or with a negative balance, fails.
- `deposit(account, amount)`: adds to the balance and returns the new balance.
- `withdraw(account, amount)`: takes the amount if the balance covers it and returns true;
  otherwise returns false and changes nothing.
- `transfer(source, target, amount)`: moves the amount between two different accounts if
  the source covers it and returns true; otherwise returns false and changes nothing.
- `balance(account)`: the account's balance.
- `total()`: the sum of every balance.

Amounts are positive; an amount of 0 or less fails, as does any unknown account or a
transfer from an account to itself. Such an invalid call fails even when the balance
wouldn't cover the amount. A failed call changes nothing. Balances and the total stay
below 2^53.

Several threads may move money at once (JavaScript and TypeScript: interleaved async
calls). Every completed call must count, and the total must only change by deposits and
withdrawals.
