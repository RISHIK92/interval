> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

After cars leave in any order, how do you still hand out the lowest-numbered free spot without searching every spot?

## Approach

Keep the free spot numbers of each size in a min-heap, so the lowest is always on top, and a map from plate to its spot's size and number. A small car tries the small spots and falls back to the large ones; a large car only looks at large spots; `leave` pushes the number back onto its heap. Do the check-and-take under one lock so no spot ever holds two cars.

## Code sketch

```text
class ParkingLot
  freeSpots: per size, a min-heap of free spot numbers (1..count)
  cars:      map plate -> (size, number)
  lock

  constructor(small, large)
    // TODO: fail on a negative count; fill each heap
  park(plate, size) -> optional<string>
    // TODO: reject an unknown size or a plate already parked
    // TODO: take the lowest spot it may use ("S3", "L1"), or null
  leave(plate) -> optional<string>
    // TODO: free the car's spot and return it; null if not parked
  where(plate) -> optional<string>
    // TODO: the car's spot, or null
  free(size) -> int
    // TODO: validate the size; how many of its spots are free
```
