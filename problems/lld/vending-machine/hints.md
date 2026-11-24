> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If a purchase finds halfway through that it can't make exact change, what must still be exactly as it was before the call?

## Approach

Track three things: the slots (item, price, count), the machine's coin counts, and the inserted coins held aside (the credit is their sum). `buy` works out greedy change, largest coin first, on a copy of the machine's coins plus the inserted ones, and commits that copy only when the change comes out exact; otherwise nothing changes. `refund` returns the inserted coins without them ever joining the machine. One lock over each call makes sure credit is spent exactly once.

## Code sketch

```text
class VendingMachine
  COINS = 100, 25, 10, 5
  slots:   map slot -> (item, price, count)
  coins:   the machine's count of each coin
  pending: inserted coins held aside (credit = their sum)
  lock

  stock(slot, item, price, count)
    // TODO: validate; replace whatever the slot held
  insert(coin) -> int
    // TODO: reject anything but COINS; hold it aside; return the credit
  balance() -> int
    // TODO: the credit
  buy(slot) -> list<int>
    // TODO: fail on an unknown or sold-out slot, or too little credit
    // TODO: greedy change on a copy of coins + pending; fail if not exact
    // TODO: commit the copy, clear pending, count - 1; return change largest first
  refund() -> list<int>
    // TODO: the pending coins, largest first; clear pending
  inventory(slot) -> int
    // TODO: the slot's count; unknown fails
  item(slot) -> string
    // TODO: the slot's item; unknown fails
```
