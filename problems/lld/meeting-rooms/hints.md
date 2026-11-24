> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If one meeting ends at 10 and another starts at 10, do they clash, and what single comparison answers that for any two intervals?

## Approach

Keep, per room, its meetings as a map from start to end, so `cancel` finds a meeting by room and start. `book` tries rooms from 1 upward, scanning each room's meetings, and takes the first room where none overlaps; half-open intervals `[s1, e1)` and `[s2, e2)` overlap exactly when `s1 < e2` and `s2 < e1`. Hold one lock across the check and the insert so no room ever holds two overlapping meetings.

## Code sketch

```text
class MeetingRooms
  rooms: list of maps start -> end, room n at index n - 1
  lock

  constructor(count)
    // TODO: fail if count < 1
  overlaps(start, end, otherStart, otherEnd) -> bool
    // TODO: true when the half-open intervals share an instant
  book(start, end) -> optional<int>
    // TODO: reject end <= start
    // TODO: the lowest room with no overlapping meeting: record it, return its number
    // TODO: null when every room clashes
  cancel(room, start) -> bool
    // TODO: remove that meeting; false for an unknown room or start
  free(at) -> int
    // TODO: count rooms with no meeting covering at (start <= at < end)
```
