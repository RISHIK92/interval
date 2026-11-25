# Prices everywhere: more locales (extension round)

> PROVISIONAL (LLD practice batch C2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

The shop is opening in more countries, and each brings its own way of writing money.

- `addLocale(locale, currencySign, signFirst, grouping, decimal)`: adds a locale that all
  three lines accept. When `signFirst` is true the sign comes right before the number with
  no space; otherwise the number, one space, then the sign. `grouping` goes between each
  group of three digits and `decimal` before the two decimal digits, both exactly as given
  and possibly longer than one character. An empty `grouping` means no separators; an empty
  `decimal` means the currency has no smaller unit, so amounts are whole units shown without
  decimals, as for yen.
- An empty locale, a locale that already exists (one of the three built in or one added
  before), or an empty `currencySign` fails. All the strings are printable ASCII.

For example, after `addLocale("en-GB", "GBP ", true, ",", ".")`,
`checkoutLine(123456, "en-GB")` is `"Total: GBP 1,234.56"`.
