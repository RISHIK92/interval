# Meeting rooms

> PROVISIONAL (P5-W30-S04): written during the build; the owner reviews it before launch.

Build a booking system for `count` identical rooms, numbered from 1.

- `MeetingRooms(count)`: `count` is at least 1, or the constructor fails; it is never
  more than 1000.
- `book(start, end)`: books the lowest-numbered room that is free for the whole interval
  `[start, end)` and returns its number, or returns null when every room is taken at
  some point in it. Meetings that only touch (one ends at 10, the next starts at 10)
  don't overlap. `end` must be after `start`, or the call fails.
- `cancel(room, start)`: removes the room's meeting that starts at `start` and returns
  true, or returns false when there's no such meeting (an unknown room included).
- `free(at)`: how many rooms have no meeting at the instant `at`, where a meeting
  `[start, end)` covers `start` but not `end`.

Times are integers, negative ones too, within ±2^53.

Several threads may book at once (JavaScript and TypeScript: interleaved async calls).
Every completed call must count, and no room may hold two overlapping meetings.
