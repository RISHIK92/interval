> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

When the same text arrives a second time, what should exist afterwards that didn't before?

## Approach

Make the symbol a small immutable record of its ID and its text, and let one factory be the only place symbols are made. The factory keeps two indexes over the same shared records: by text, to find an existing symbol, and by ID, for lookups. Interning checks the text index first: a hit returns the shared symbol's ID and adds the text's length to the savings; a miss makes one new record with the next ID and puts it in both indexes. A lookup is a range check and an index read.

## Code sketch

```text
record Symbol(id, text)   // immutable, shared

class Interner
  byText: map text -> Symbol
  byId: list of Symbol
  saved = 0

  intern(text) -> int
    // TODO: fail on ""
    // TODO: a hit: count the bytes saved, return its id
    // TODO: a miss: make Symbol(next id, text), index it twice
  lookup(id) -> string
    // TODO: fail outside 0..size-1
  size() -> int
  bytesSaved() -> int
```
