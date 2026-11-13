# Order book: amending orders (extension round)

> PROVISIONAL (P5-W33): written during the build; the owner reviews it before launch.

Traders want to amend resting orders, and the desk wants a running total.

- `modify(id, qty)`: sets the open quantity of an order that is in the book to `qty`. An
  order that is not in the book, or a `qty` that is not valid, fails and changes nothing.
  Whether the order keeps its place in the queue is for you to settle with the interviewer.
- `traded()`: the total quantity matched since the book was created (one trade of 3 counts
  3, not 6).

Everything above still works as before. `modify` and `traded` change nothing about the
earlier methods.
