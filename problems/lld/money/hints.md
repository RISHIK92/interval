> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

When 1000 cents can't be divided evenly by 3, where should the leftover cent go so that the parts still add up to 1000?

## Approach

Store the amount as an integer number of cents with its currency, validated once in one function that the constructor and `add` both use, and never changed afterwards. Formatting lives in one place too: whole units are cents divided by 100, and the rest is the remainder padded to two digits. To split, use integer division for the equal share and the remainder for how many leading parts get one extra cent; nothing is ever rounded away.

## Code sketch

```text
class Money
  cents, currency   // set once

  checked(cents, currency)
    // TODO: fail unless 0 <= cents <= 10^12 and currency is 3 capital letters
  constructor(cents, currency)
    // TODO: checked(...), then store
  show(cents) -> string
    // TODO: "<currency> <cents / 100>.<cents % 100, two digits>"
  add(cents, currency) -> string
    // TODO: checked(...); fail on another currency
    // TODO: show(this.cents + cents)
  split(parts) -> list<string>
    // TODO: fail unless 1 <= parts <= 100
    // TODO: share = cents / parts, left = cents % parts
    // TODO: the first `left` parts get share + 1
  display() -> string
```
