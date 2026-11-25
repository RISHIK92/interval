> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If `90m` and `1h30m` must be equal, what single number could both of them be stored as?

## Approach

Store only the total number of seconds, computed once by one parsing function that every method taking text shares. The spelling is then forgotten: equality, comparison and addition are plain arithmetic on totals. Formatting goes the other way in one place too: split a total into hours, minutes under 60 and seconds under 60, and write only the non-zero ones. Never change the stored total; `plus` returns new text.

## Code sketch

```text
class Duration
  total   // seconds, set once

  parseSeconds(text) -> int
    // TODO: match optional <digits>h, <digits>m, <digits>s, in that order
    // TODO: fail on empty text or no match
    // TODO: hours * 3600 + minutes * 60 + seconds
  format(total) -> string
    // TODO: "0s" for zero; else the non-zero h, m, s parts
  constructor(text)
    // TODO: total = parseSeconds(text)
  totalSeconds() -> int
  canonical() -> string
    // TODO: format(total)
  plus(other) -> string
    // TODO: format(total + parseSeconds(other))
  isLonger(other) -> bool
    // TODO: total > parseSeconds(other)
```
