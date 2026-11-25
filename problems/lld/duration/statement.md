# Duration value

> PROVISIONAL (LLD practice batch A1, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build an immutable duration parsed from text such as `1h30m15s`. Two durations of the same
length are equal however they were spelled: `90m`, `1h30m` and `5400s` are one value with
one canonical form.

A duration's text is one or more parts, each a number of 1 to 9 ASCII digits (leading
zeros allowed) followed by its unit: `h` (hours), `m` (minutes) or `s` (seconds). Each
unit appears at most once, in the order h, m, s. A part may be any size (`90m`, `3661s`).
Nothing else is allowed: no empty text, spaces, signs, decimals, capital units, or
number without a unit. Every method that takes a duration's text fails on a malformed one.

- `Duration(text)`: parses it, or fails.
- `totalSeconds()`: its length in seconds.
- `canonical()`: its canonical form: hours, then minutes under 60, then seconds under 60,
  each written only when it's above 0, with no leading zeros (`1h1s`, `1h40m`, `25h`).
  A zero duration is `0s`.
- `plus(other)`: the canonical form of the two durations added together. This duration is
  unchanged.
- `isLonger(other)`: true when this duration is strictly longer than `other`.
