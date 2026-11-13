# Order book: interviewer's notes

PRIVATE. Never shown to players. Answer a player's question only from these notes. If a
point is not here, say it is not specified and the player should choose and document it.
Answer briefly and do not volunteer other points or reveal the test layout. Do not write
code for the player.

## Sides, ids and numbers

- Side is exactly `"buy"` or `"sell"`, lower case. Anything else (`"Buy"`, `""`, `"hold"`) is an error, in
  `place`, `best` and `depth`.
- Price is an integer from 1 to 1000000 inclusive. Tick size is 1 (any integer in range is fine). 0, negative
  and above 1000000 are errors.
- Quantity is an integer from 1 to 1000000 inclusive. 0, negative and above 1000000 are errors.
- An id is any non-empty string. The empty string is an error.
- Ids are unique for the life of the book: placing an id that was ever accepted is an error, even if that order
  was filled or cancelled since. An order that was accepted and fully filled on arrival also uses up its id.
- There are no traders or accounts, only order ids, so there is no self-trade rule: any buy can match any sell.

## place

- Validation order does not matter, since every failure is just an error. A failed `place` changes nothing.
- A buy matches sells whose price is at or below its limit; a sell matches buys at or above its limit. Lowest sell
  first for a buy; highest buy first for a sell.
- Within one price, the oldest order first (first come, first served).
- Each trade is at the resting (maker) order's price, not the incoming order's price. The incoming order is
  filled up to the quantity it asks for.
- Each fill is the text `"<resting id>:<price>:<qty>"`, one per resting order touched, in the order they
  happened. A single resting order is never split across two fills for one `place`. No fills gives an empty
  list.
- Whatever quantity is not filled rests in the book at the order's limit price, at the back of its price level.
  It is a limit order that rests, not "fill or kill" or "immediate or cancel".
- A buy and a sell never both rest at crossing prices: the book is never crossed after a `place`.
- A partly filled resting order keeps its place at the front of its queue; the next incoming order fills it
  again first.

## cancel

- Returns the quantity still open (so a partly filled order returns what was left), and the order leaves the book.
- Unknown id: error. An id that is already filled: error. An id already cancelled: error. The empty id: error.
  There is no result value for these cases: they are errors, not a false or a zero.

## remaining

- The open quantity if the order is in the book, otherwise nothing (null/None). That covers unknown ids, filled
  orders and cancelled orders. It never fails, even for the empty id.

## best and depth

- `best(side)`: the best price on that side (highest bid, lowest ask), or nothing when the side is empty. An unknown
  side is an error.
- `depth(side, levels)`: levels come best first (buys from the highest price down, sells from the lowest price
  up). Each level gives two numbers: the price and the sum of the open quantities of every order at that price.
  Only the first `levels` price levels. Fewer levels than asked for is fine (no padding). `levels` = 0 gives an
  empty list. `levels` negative is an error. An unknown side is an error. An empty side gives an empty list.

## Extension: modify and traded

- `modify(id, qty)`: `qty` is the new open quantity (not an amount to add). The order must be in the book:
  an unknown, filled or cancelled id is an error. `qty` must be 1 to 1000000, else an error. A failed call
  changes nothing.
- Lowering the quantity keeps the order's place in its queue. Setting the same quantity keeps it, too. Raising
  the quantity sends the order to the back of its price level. The price and side never change; to change a
  price the trader cancels and places a new id.
- Raising the quantity above its original placed quantity is allowed (the new open quantity is just `qty`).
- `modify` does not trade; it never matches anything.
- `traded()`: the sum of the quantities of all fills so far. One fill of 3 adds 3. It does not change with
  cancels or modifies. 0 for a new book.

## Threads

- Every completed call counts. Calls behave as if they ran one at a time in some order. The book needs a lock
  (or the language's equivalent). There is nothing else to say about concurrency.

## Not specified (tell the player it is their choice)

- How the book is stored, performance targets, anything about persistence, fees, market orders or order types
  other than the limit order described above.
