# Money

> PROVISIONAL (LLD practice batch A1, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build an immutable amount of money: a whole number of cents in one currency. Money is
never a float, so no cent is ever gained or lost.

Wherever an amount is given (the constructor and `add`), its cents are from 0 to 10^12
inclusive and its currency is exactly three capital ASCII letters (`USD`, `EUR`), or the
call fails. Every currency has 100 cents to its unit.

An amount is shown as its currency, a space, its whole units, a `.` and its cents as two
digits: 1000 cents in USD is `USD 10.00`, 7 cents in EUR is `EUR 0.07`.

- `Money(cents, currency)`: the amount, or fails.
- `add(cents, currency)`: the sum of this amount and the given one, shown as above. A
  different currency fails. This amount is unchanged.
- `split(parts)`: the amount divided into `parts` amounts that add up to exactly the
  original, in a list. Every part gets the same whole number of cents, and the cents left
  over go one each to the first parts: 1000 cents in 3 parts are `USD 3.34`, `USD 3.33`,
  `USD 3.33`. `parts` is from 1 to 100, or the call fails.
- `display()`: this amount, shown as above.
