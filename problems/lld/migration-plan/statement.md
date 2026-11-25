# Schema migration plan

> PROVISIONAL (LLD practice batch C2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build the plan a schema migration tool follows. Migrations are numbered, applied in
ascending order of version up to a target, and rolled back newest first. Each operation
states its preconditions, and either happens in full or fails and changes nothing: there's
never a half-applied plan.

The applied migrations are always the lowest-numbered ones in the plan; the **current**
version is the highest applied one (0 when none is), and every version above it is
**pending**.

- `MigrationPlan()`: an empty plan; the current version is 0.
- `add(version, name)`: plans a migration. It fails when `version` is outside 1 to 10^9,
  `name` is empty, the version is already planned, or the version is below the current
  one (it could never be applied). Names need not be unique.
- `applyUpTo(version)`: applies every pending migration up to and including `version`, in
  ascending order, and returns their names in that order. `version` must be a planned
  version, and not below the current one, or the call fails. Applying up to the current
  version returns an empty list.
- `rollback(steps)`: undoes the `steps` most recently applied migrations, newest first, and
  returns their names in that order; they become pending again. `steps` outside 1 to the
  number applied fails.
- `current()`: the current version.
- `pending()`: the pending versions, ascending.

Names are printable ASCII, kept exactly as given. There are at most 1000 planned migrations
and at most 10^4 calls.

For example, with versions 1, 2 and 5 planned, `applyUpTo(2)` returns the names of 1 and
2, the current version is 2, and `pending()` is `[5]`.
