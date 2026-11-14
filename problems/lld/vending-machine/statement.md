# Vending machine

> PROVISIONAL (P5-W34-S01): written during the build; the owner reviews it before launch.

Build a vending machine that takes coins, sells from numbered slots and makes change from
its own coins.

Coins are 100, 25, 10 and 5 (cents); a price may be any positive amount.

- `VendingMachine()`: no slots, no coins, no credit.
- `stock(slot, item, price, count)`: sets the slot to this item, price and count, replacing
  whatever it held. Fails for an empty slot or item, a price of 0 or less, or a negative
  count. A count of 0 is allowed (a sold-out slot).
- `insert(coin)`: adds one coin to the credit and returns the new credit. Any other value
  fails. Inserted coins are held aside and do not yet belong to the machine.
- `balance()`: the credit.
- `buy(slot)`: sells one item and returns the change as a list of coins, largest first
  (an empty list when the credit equals the price). It fails for an unknown slot, a slot
  with a count of 0, a credit below the price, or when the exact change can't be made.
  The change is made greedily from the largest coin down: of each coin, take as many as
  fit in what is still owed and as the machine holds, counting the coins inserted for this
  purchase as the machine's. Greedy is the rule even when a different mix of coins would
  have paid (30 owed, one 25 and three 10s held: it takes the 25, then has no 5, and
  fails). On success the slot's count drops by one, all inserted coins join the machine's
  coins, the change leaves them and the credit is 0 (any excess over the price is paid out
  as that change, never kept).
- `refund()`: returns every coin inserted since the last purchase or refund, largest
  first, and the credit is 0. Those coins never join the machine's coins.
- `inventory(slot)`: the slot's count. Fails for an unknown slot.
- `item(slot)`: the slot's item name. Fails for an unknown slot.

A failed call changes nothing: after a failed `buy` the credit is still there. Slots are
matched exactly (case counts). Counts, prices and credits stay below 2^53.

Several threads may use the machine at once (JavaScript and TypeScript: interleaved async
calls). Every completed call must count, and a purchase must use the credit exactly once.
