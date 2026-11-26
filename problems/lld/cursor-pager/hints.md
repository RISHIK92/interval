> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

A page starts right after the cursor item: how do you find where that is without scanning every item?

## Approach

Keep the items in one sorted list. Paging is a binary search for the cursor (failing if it isn't there), then a slice of at most a page from the position after it; the next cursor is that slice's last item, but only if something comes after the slice. Put the one-at-a-time walk in its own iterator object over the same list, which remembers where it got to between calls, so the pager's hasNext and next just ask it.

## Code sketch

```text
class Walk                        // the iterator
  items: shared sorted list
  // TODO: where it got to
  hasNext() -> bool
  next() -> string                // TODO: fail when none left

class ResultPager
  items: sorted list; size; walk: Walk

  constructor(items, pageSize)
    // TODO: fail on "", a repeat, a size outside 1..1000; sort
  hasNext() / next()              // ask the walk
  start(cursor) -> int
    // TODO: "" -> 0; binary search; fail if missing; else index + 1
  page(cursor) -> list<string>
    // TODO: items[start .. start + size]
  nextCursor(cursor) -> optional<string>
    // TODO: the page's last item, if anything comes after the page
```
