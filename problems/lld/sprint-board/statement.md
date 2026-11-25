# Sprint board

> PROVISIONAL (LLD practice batch A2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build a sprint board. Every ticket is in exactly one of four columns, in this order:
`todo`, `doing`, `review`, `done`. A ticket moves one column at a time, forwards or back
(moving a `done` ticket back to `review` reopens it), and `doing` has a work-in-progress
limit.

- `SprintBoard(wipLimit)`: an empty board whose `doing` column holds at most `wipLimit`
  tickets. `wipLimit` is from 1 to 100, or the constructor fails.
- `add(title, points)`: adds a ticket to `todo` and returns its id: `"T-1"` for the first
  ticket added, `"T-2"` for the second, and so on. An empty title, or `points` outside 1
  to 100, fails; a failed call adds nothing and uses up no id.
- `move(ticket, column)`: moves the ticket to the named column and returns true. It
  returns false and changes nothing when the column isn't next to the ticket's current one
  (its own column, or one or more columns away), or when the column is `doing` and `doing`
  already holds `wipLimit` tickets. An unknown ticket, or a column that isn't one of the
  four names exactly (case matters), fails.
- `column(ticket)`: the name of the ticket's column. An unknown ticket fails.
- `velocity()`: the sum of the points of the tickets in `done`, 0 when there are none.

Titles are printable ASCII and are kept but never shown. A board holds at most 10,000
tickets.
