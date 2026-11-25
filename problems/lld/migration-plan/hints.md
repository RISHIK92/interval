> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If you check a precondition halfway through applying or rolling back, what state is the plan left in when it fails?

## Approach

Keep the planned versions sorted, with their names alongside, and the number applied. Because applied migrations are always the lowest ones, that count is all the state you need: the current version is the last applied one and the pending ones are the rest. Every operation checks all its preconditions first and only then changes the count (or inserts a version), so a failure never leaves anything half done. Applying moves the count to just past the target; rolling back moves it down by `steps`.

## Code sketch

```text
class MigrationPlan
  versions: sorted list of int
  names: map version -> name
  applied: int                  // how many of versions are applied

  add(version, name)
    // TODO: check range, name, not planned, above current
    // TODO: insert in order; remember the name
  applyUpTo(version) -> list
    // TODO: check planned and not below current
    // TODO: new count = versions at or below target
    // TODO: return names of versions[old..new]
  rollback(steps) -> list
    // TODO: check 1 <= steps <= applied
    // TODO: names of the last steps applied, newest first
    // TODO: applied -= steps
  current() -> int
    // TODO: versions[applied - 1], or 0
  pending() -> list
    // TODO: versions[applied..]
```
