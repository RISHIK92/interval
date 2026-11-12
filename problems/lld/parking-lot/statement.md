# Parking lot

> PROVISIONAL (P5-W30-S03): written during the build; the owner reviews it before launch.

Build a parking lot with small and large spots. Spots are named `S1`, `S2`, … and
`L1`, `L2`, …, and a car always gets the lowest-numbered free spot it may use.

- `ParkingLot(small, large)`: how many spots of each size (0 or more; a negative count
  fails).
- `park(plate, size)`: `size` is `"small"` or `"large"`; anything else fails. A small car
  takes the lowest free small spot, or the lowest free large spot when no small one is
  free; a large car takes only large spots. Returns the spot, or null when there's none.
  Parking a plate that is already parked fails and changes nothing.
- `leave(plate)`: frees the car's spot and returns it, or null when the plate isn't
  parked.
- `where(plate)`: the car's spot, or null.
- `free(size)`: how many spots of that size are free; an unknown size fails.

Several threads may park cars at once (JavaScript and TypeScript: interleaved async
calls). Every completed call must count, and no spot may hold two cars.
