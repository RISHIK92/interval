# Warehouse stock

> PROVISIONAL (LLD practice batch A2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build the stock keeping for a warehouse. Stock is counted per SKU, and orders reserve it,
then either ship it or cancel. For every SKU, after every call:

- **on hand** (what is physically in the warehouse) = **available** + **reserved**;
- reserved stock is exactly what the open orders hold, and nothing is ever negative.

An order is open from a successful `reserve` until it is shipped or cancelled. A
reservation is all or nothing: an order never holds part of what it asked for.

- `Warehouse()`: starts empty.
- `receive(sku, qty)`: `qty` more of the SKU arrive. Returns the SKU's new on-hand count,
  reserved stock included.
- `reserve(orderId, sku, qty)`: if `qty` is at most the SKU's available stock, the order
  reserves it and the call returns true. Otherwise it returns false and changes nothing,
  so the order id is still unused. An order id that has been used before (by an open,
  shipped or cancelled order, for any SKU) fails, even when the stock is short.
- `ship(orderId)`: the open order's stock leaves the warehouse (it is no longer on hand or
  reserved) and the call returns true. An unknown, shipped or cancelled order returns
  false.
- `cancel(orderId)`: the open order's stock becomes available again and the call returns
  true. An unknown, shipped or cancelled order returns false.
- `available(sku)`: the SKU's available stock; 0 for a SKU never received.

An empty SKU or order id fails in every call, and `qty` outside 1 to 10^9 fails. A call
that fails changes nothing. On-hand counts stay below 2^53.
