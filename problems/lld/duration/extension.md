# Duration value: scaling (extension round)

> PROVISIONAL (LLD practice batch A1, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Timeouts are often a multiple of another duration ("one and a half times the deploy
time").

- `scaled(factor)`: the canonical form of this duration times `factor`, rounded down to
  whole seconds. The product is a 64-bit floating-point multiplication of the total
  seconds by `factor`, then rounded down, so `100s` scaled by `0.29` is `28s` (the product
  is 28.999…). This duration is unchanged.
- `factor` is from 0 to 1000 inclusive; anything else fails.
