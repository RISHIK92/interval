> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

Which numbers do you store, and which do you work out from them, so that "on hand = available + reserved" can never stop being true?

## Approach

Store two counts per SKU, on hand and reserved, and derive available as their difference, so the invariant holds by construction. Keep the open orders (order id to SKU and quantity) and every order id ever used, all private. Every method checks its arguments and its refusal first, and only then changes the counts: `reserve` raises reserved, `cancel` lowers it, `ship` lowers both reserved and on hand by the order's quantity, and closing an order removes it from the open ones so it can't ship or cancel twice.

## Code sketch

```text
class Warehouse
  onHand: map sku -> int
  reserved: map sku -> int
  open: map orderId -> (sku, qty)
  used: set of orderId

  receive(sku, qty) -> int
    // TODO: validate; onHand[sku] += qty; return it
  available(sku) -> int
    // TODO: onHand[sku] - reserved[sku], 0 when unknown
  reserve(orderId, sku, qty) -> bool
    // TODO: validate; fail when orderId is in used
    // TODO: false when qty > available(sku)
    // TODO: record the order; reserved[sku] += qty
  close(orderId) -> optional (sku, qty)
    // TODO: take it out of open; reserved[sku] -= qty
  ship(orderId) -> bool
    // TODO: close it; onHand[sku] -= qty
  cancel(orderId) -> bool
    // TODO: close it
```
