# Prices everywhere

> PROVISIONAL (LLD practice batch C2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A shop shows money on checkout lines, receipt lines and email summaries, in three locales.
The same amount must read identically everywhere it appears.

Amounts are in the currency's smallest unit: cents for dollars and euros, and whole yen for
yen, which has no smaller unit.

| Locale    | Sign    | Where the sign goes               | Groups of three digits | Decimal mark      |
| --------- | ------- | --------------------------------- | ---------------------- | ----------------- |
| `"en-US"` | `"$"`   | before the number, with no space  | `","`                  | `"."`             |
| `"de-DE"` | `"EUR"` | after the number, after one space | `"."`                  | `","`             |
| `"ja-JP"` | `"JPY"` | after the number, after one space | `","`                  | none: no decimals |

A price is the whole units with a separator between each group of three digits, counted
from the right, then, where the currency has decimals, the decimal mark and exactly two
digits. So 123456 is `"$1,234.56"`, `"1.234,56 EUR"` and `"123,456 JPY"`; 5 is `"$0.05"`, and 0
is `"0,00 EUR"` and `"0 JPY"`.

- `PriceFormatter()`: knows the three locales above.
- `checkoutLine(cents, locale)`: `"Total: <price>"`.
- `receiptLine(item, cents, qty, locale)`: `"<item> <qty> x <unit price> = <line price>"`,
  where `cents` is the unit price and the line price is `cents × qty`; for example
  `"coffee 2 x $3.50 = $7.00"`. The item is kept exactly as given, and `<qty>` is plain digits, never grouped (`1000`).
- `emailSummary(totalCents, locale)`: `"Your order comes to <price>."`

An unknown locale (case matters) fails, and so do an empty item, `qty` outside 1 to 1000,
a unit price outside 0 to 10^9, and an amount outside 0 to 10^12 in `checkoutLine` and
`emailSummary`. Items and locales are printable ASCII. There are at most 10^4 calls.
