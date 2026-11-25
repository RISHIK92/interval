# Money: allocation by ratio (extension round)

> PROVISIONAL (LLD practice batch A1, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Revenue is shared by ratio, not equally: 70% to one team and 30% to another.

- `allocate(weights)`: the amount divided by the given weights, one amount per weight, in
  order, adding up to exactly the original. Part `i` first gets `cents × weights[i] ÷ sum
of weights`, rounded down. The cents left over then go one each to the parts with a
  weight above 0, first to last, so a part weighted 0 always gets nothing.
  - 1000 cents by `[1, 2]`: 333 and 666, and the one cent left goes to the first:
    `USD 3.34`, `USD 6.66`.
  - 5 cents by `[0, 1, 1]`: 0, 2 and 2, and the cent left goes to the second part.
- There are 1 to 100 weights, each from 0 to 1000, and at least one above 0; anything else
  fails. This amount is unchanged.
