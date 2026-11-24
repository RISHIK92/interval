> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

What should `shorten` do when the counter's next code is already someone's custom alias?

## Approach

Keep one map from every code, generated or custom, to its url and hit count, a separate map from url to its generated code, and a counter starting at 1. Encode the counter in base62 (`0-9`, then `a-z`, then `A-Z`, most significant digit first) and skip any value whose code is already taken. The invariants: generated codes and aliases share one namespace, `custom` never touches the counter or the url's generated code, and hits are counted per code. Validate urls and aliases before taking the lock and do the rest under it.

## Code sketch

```text
class UrlShortener
  ALPHABET = 0-9, a-z, A-Z (62 characters)
  urls:      map code -> url (generated codes and aliases)
  counts:    map code -> hits
  generated: map url -> its generated code
  counter = 1
  lock

  encode(n) -> string
    // TODO: n in base62 over ALPHABET, most significant digit first
  shorten(url) -> string
    // TODO: validate; return the url's generated code if it has one
    // TODO: else take counter values until a code is free; record it
  expand(code) -> string
    // TODO: fail if unknown; count a hit for this code; return the url
  custom(url, alias) -> string
    // TODO: validate both; fail if the alias is taken; record it
  hits(code) -> int
    // TODO: the code's hit count; unknown fails
```
