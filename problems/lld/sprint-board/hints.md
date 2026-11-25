> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If the columns were a fixed, ordered set instead of four strings, how would you tell in one comparison whether a move is to a neighbouring column?

## Approach

Make the columns an enumeration in board order and keep each ticket's column as that enumeration, private to the board; names are turned into the enumeration only at the edge, where an unknown name fails. A move is legal when the two positions differ by exactly one, and a move into `doing` also needs a free slot, counted from the tickets that are there now. Keep the tickets in the order they were added, so ids are simply their position plus one, and velocity is a sum over the tickets in `done`.

## Code sketch

```text
enum Column { TODO, DOING, REVIEW, DONE }

class Ticket
  points, column = TODO

class SprintBoard
  limit
  tickets: map id -> Ticket, in the order added

  constructor(wipLimit)
    // TODO: fail unless 1 <= wipLimit <= 100
  add(title, points) -> string
    // TODO: fail on an empty title or points outside 1-100
    // TODO: id = "T-" + (count + 1); store it in TODO
  move(ticket, column) -> bool
    // TODO: fail on an unknown ticket or column name
    // TODO: false unless the positions differ by exactly 1
    // TODO: false when moving into DOING and it already holds limit tickets
    // TODO: otherwise move it; true
  column(ticket) -> string
  velocity() -> int
    // TODO: sum of points in DONE
```
