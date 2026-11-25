# Warehouse stock: write-offs (extension round)

> PROVISIONAL (LLD practice batch A2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Some stock arrives damaged or breaks on the shelf, and has to be written off.

- `writeOff(sku, qty)`: if `qty` is at most the SKU's available stock, that much leaves
  the warehouse (on hand drops by `qty`) and the call returns true. Otherwise it returns
  false and changes nothing. Stock reserved by open orders is never written off, so every
  open order can still ship.
- An empty SKU, or `qty` outside 1 to 10^9, fails and changes nothing. A SKU never
  received has nothing available, so writing it off returns false.
