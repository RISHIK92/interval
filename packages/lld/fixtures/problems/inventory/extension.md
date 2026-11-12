# Inventory: reservations (extension round)

Some stock can now be held back for a customer.

- `reserve(item, amount)`: holds back `amount` units of the item if that many are in
  stock and not already held, returning true; otherwise false. A non-positive amount
  fails.
- `reserved(item)`: how many units of the item are held back (0 for none).
- `take` may only take units that aren't held back. `clear` also clears reservations.
