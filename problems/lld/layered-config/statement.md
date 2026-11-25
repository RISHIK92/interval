# Layered config

> PROVISIONAL (LLD practice batch A4a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A service reads its settings from four sources. From lowest to highest precedence they are
`defaults`, `file`, `env` and `flags`: a key set in a higher source overrides the same key
in every lower one. Looking a key up finds the winning value as text and where it came
from; turning that text into a number is a separate step.

- `LayeredConfig()`: every source starts empty.
- `layer(source, entries)`: replaces everything `source` held with `entries` (key to
  value). An empty map empties the source. An unknown source name, or an empty key in
  `entries`, fails. Values may be empty: an empty value is still a value.
- `lookup(key)`: the value from the highest-precedence source that has `key`, or null
  when no source has it.
- `origin(key)`: the name of that source, or null when no source has `key`.
- `intValue(key)`: the winning value read as an integer, or null when no source has
  `key`. An integer is an optional `-` followed by 1 to 15 decimal digits and nothing
  else (`007` is 7, `-0` is 0). When the winning value isn't one, the call fails, even if
  a lower source holds an integer.

An empty key fails in every call. A call that fails changes nothing. Source names, keys and
values are printable ASCII, and names and keys are case-sensitive. A source holds at most 100 entries, and there are
at most 10^4 calls.
