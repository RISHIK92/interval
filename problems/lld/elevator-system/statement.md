# Elevator system

> PROVISIONAL (P5-W34): written during the build; the owner reviews it before launch.

Build a controller for several elevators in one building. Elevators are numbered
`0..elevators-1`. Floors are numbered `0..floors` (so `floors` is the top floor). Time
moves only when `step()` is called. Every elevator starts at floor 0 with no stops.

Each elevator keeps a set of **stops**: floors it has to open its doors at.

- `ElevatorSystem(elevators, floors)`: both must be at least 1; anything else fails.
- `request(floor)`: someone calls an elevator to `floor`. A floor outside `0..floors`
  fails. If some elevator already has `floor` among its stops, return the lowest-numbered
  such elevator and change nothing. Otherwise pick the elevator with the lowest cost, where
  cost = (distance from its current floor to `floor`) + (its number of stops); ties go to
  the lowest-numbered elevator. Add `floor` to its stops and return its number.
- `press(elevator, floor)`: someone inside `elevator` presses `floor`. An unknown elevator
  or a floor outside `0..floors` fails. Returns true when the stop was added, false when
  that elevator already had it as a stop. Pressing the floor the elevator is standing at
  adds a stop like any other.
- `step()`: advances every elevator by one tick, and returns the doors that opened, as
  strings `"<elevator>:<floor>"`, in elevator order. An elevator with no stops does
  nothing. Otherwise its **target** is the stop nearest to its current floor (ties go to
  the lower floor):
  - if the target is the floor it is on, it opens its doors there (the stop is removed)
    and does not move;
  - otherwise it moves one floor toward the target, and if that floor is one of its stops,
    it opens its doors there (the stop is removed).
- `status(elevator)`: a string `"<floor> <state> <stops>"`. The state is `idle` with no
  stops; otherwise `up` or `down` toward the target, or `here` when the target is the
  current floor. Stops are listed ascending, separated by commas; with none, `-`.
  For example `"3 up 5,7"` or `"0 idle -"`. An unknown elevator fails.

Several threads may call at once (JavaScript and TypeScript: interleaved async calls).
Every call must be atomic with respect to the others.
