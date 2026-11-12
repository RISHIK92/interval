# Meeting rooms: running over (extension round)

> PROVISIONAL (P5-W31-S02c): written during the build; the owner reviews it before launch.

Meetings now run over (or finish early).

- `extend(room, start, end)`: moves the end of the room's meeting that starts at `start`
  to `end` and returns true, if the room is free for the new interval apart from that
  meeting itself. Ending earlier always fits. Returns false when the room has no meeting
  starting at `start` (an unknown room included) or the new end would overlap another
  of its meetings, and changes nothing. Overlap means what it means for `book`: a
  meeting that ends exactly at `start`, or starts exactly at `end`, doesn't clash.
- `end` must be after `start`, or the call fails; that is checked first, so it fails
  for an unknown room too.
- Booking and `free` then use the new end.
