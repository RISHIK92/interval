> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If `bump` returned this same object changed in place, what would a caller holding the old version see afterwards?

## Approach

Parse once, in one function, into three numbers, and keep them as the version's only state. Every method that takes another version's text runs it through the same parser, so the rules (three parts, digits only, no leading zero) live in one place. `bump` builds and returns new text from the numbers and never assigns to them. Compare the parts as numbers in order (major, then minor, then patch); compatibility is a same-major check with an extra same-minor rule when major is 0.

## Code sketch

```text
class SemVer
  major, minor, patch   // set once, never reassigned

  parse(text) -> (int, int, int)
    // TODO: exactly three parts split on "."
    // TODO: each 1-9 digits, no leading zero, else fail
  constructor(text)
    // TODO: store parse(text)
  bump(part) -> string
    // TODO: build the next version's text; never change this one
  compareTo(other) -> int
    // TODO: compare (major, minor, patch) with parse(other): -1, 0 or 1
  isCompatible(other) -> bool
    // TODO: same major; when major is 0, same minor too
  text() -> string
    // TODO: "major.minor.patch"
```
