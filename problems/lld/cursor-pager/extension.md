# Cursor pagination: live results (extension round)

> PROVISIONAL (LLD practice batch 8a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

New matches arrive while clients are still reading the results, and a client must never
see an item twice or miss one that was there when it got past that point.

- `insertItem(item)`: adds an item to the results, in its sorted place. An empty item, or
  one already in the results, fails.
  - The walk carries on from the last item `next()` returned: an item inserted after it
    is returned in its turn, and one inserted before it never is. `hasNext()` follows the
    same rule.
  - Pages and cursors follow the items as they are now: `page(cursor)` is still the items
    after the cursor, and an inserted item can be used as a cursor.
