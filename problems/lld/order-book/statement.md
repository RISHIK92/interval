# Order book

> PROVISIONAL (P5-W33): written during the build; the owner reviews it before launch.

You are building the matching core of a small exchange for one instrument. Traders send
limit orders to buy or sell; the book matches them against each other and keeps what is
left. The requirements below are what the desk wrote down. They are not complete: ask the
interviewer about anything they leave open, and say in your code what you decided.

- `OrderBook()`: an empty book.
- `place(id, side, price, qty)`: a new order, `side` being `"buy"` or `"sell"`. It trades
  against the opposite side while the prices cross, best price first and, at one price,
  oldest first. Whatever is left rests in the book. It returns the fills it made, in the
  order they happened, each as the text `"<resting id>:<price>:<qty>"`.
- `cancel(id)`: takes an order out of the book and returns the quantity that was still
  open.
- `remaining(id)`: the open quantity of an order, or nothing if it is not in the book.
- `best(side)`: the best price on a side, or nothing if the side is empty.
- `depth(side, levels)`: the best `levels` price levels of a side, best first, as a flat
  list: price, total open quantity, price, total open quantity, and so on.

Bad input fails and changes nothing: that covers an unknown side, a price or quantity
that is not valid, an id that cannot be used, and a cancel that cannot be done. Which
inputs are bad is for you to settle with the interviewer. A failed call must leave the
book exactly as it was.

Prices and quantities are integers. Several threads may call at once (JavaScript and
TypeScript: interleaved async calls). Every completed call must count.
