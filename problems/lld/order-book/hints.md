> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

When an incoming order crosses several resting orders, which one does it meet first, and when exactly does matching stop?

## Approach

Keep each side as price levels, each a FIFO queue of order ids (best price first, oldest first within a price), plus a map from id to its order. `place` validates everything before touching the book, then repeatedly trades with the front order of the opposite side's best level while the prices cross, and rests whatever is left at the back of its own level. The invariant: the book is never crossed after a `place`, and a failed call leaves it exactly as it was, all under one lock. Ask the interviewer which inputs and ids are invalid, at what price a trade happens, and how `cancel` and `remaining` behave for orders no longer in the book.

## Code sketch

```text
class OrderBook
  levels: per side, map price -> queue of ids (oldest first)
  orders: map id -> its order (side, price, open qty, ...)
  lock: held by every method; validate before changing anything

  place(id, side, price, qty) -> list<string>
    // TODO: validate side, price, qty and id (rules per the interviewer)
    // TODO: match against the opposite side's best levels while prices cross
    // TODO: one "<resting id>:<price>:<qty>" per resting order touched; rest the leftover
  cancel(id) -> int
    // TODO: take the order out of its level; return its open qty
    // TODO: which ids can't be cancelled: per the interviewer
  remaining(id) -> optional<int>
    // TODO: the open qty of an order in the book; other cases per the interviewer
  best(side) -> optional<int>
    // TODO: the best price on the side, or null when it is empty
  depth(side, levels) -> list<int>
    // TODO: the first `levels` prices best first, each followed by its total open qty
```
