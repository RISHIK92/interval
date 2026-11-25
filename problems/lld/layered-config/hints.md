> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

`lookup`, `origin` and `intValue` all start by finding the same thing. What is that thing, and which one of them should know about turning text into a number?

## Approach

Keep one map of entries per source, untouched, and the sources in a fixed list from lowest to highest precedence. One private resolver walks that list from the top and returns the winning source together with its value, or nothing. `lookup` and `origin` each take their half of that pair. `intValue` hands the winning text to a separate integer parser that knows the format and fails on anything else, so lookup never needs to know what an integer looks like.

## Code sketch

```text
SOURCES = [defaults, file, env, flags]   // lowest first

parseInteger(text) -> int
  // TODO: fail unless it matches an optional '-' and 1-15 digits

class LayeredConfig
  layers: map source -> map key -> value

  layer(source, entries)
    // TODO: fail on an unknown source or an empty key; replace the map
  winner(key) -> (source, value) or none
    // TODO: fail on an empty key
    // TODO: walk SOURCES from the top; first source holding key wins
  lookup(key) -> optional string     // TODO: value of winner
  origin(key) -> optional string     // TODO: source of winner
  intValue(key) -> optional int
    // TODO: none stays none; otherwise parseInteger(value)
```
