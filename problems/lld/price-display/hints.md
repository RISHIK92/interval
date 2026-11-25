> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

Three lines show prices in three locales. If you found a bug in how euros are grouped, how many places would you have to fix it?

## Approach

Treat a locale as data: its sign, whether the sign goes first, its group separator and its decimal mark (none for yen). One function turns an amount and a locale into a price: split off the two decimal digits when there are decimals, group the whole part in threes from the right, then place the sign. The three lines look up the locale, check their own arguments, and only build their sentence around that one function's output.

## Code sketch

```text
Locale(sign, signFirst, grouping, decimal)

price(locale, amount) -> string
  // TODO: if decimal: whole = amount / 100; tail = decimal + 2 digits
  // TODO: else whole = amount; tail = ""
  // TODO: group whole's digits in threes from the right
  // TODO: put the sign first, or after a space

class PriceFormatter
  locales: map name -> Locale   // en-US, de-DE, ja-JP

  checkoutLine(cents, locale) -> string
    // TODO: check range and locale; "Total: " + price
  receiptLine(item, cents, qty, locale) -> string
    // TODO: check item, qty, cents and locale
    // TODO: item, qty, price(cents), price(cents * qty)
  emailSummary(totalCents, locale) -> string
    // TODO: check; "Your order comes to " + price + "."
```
