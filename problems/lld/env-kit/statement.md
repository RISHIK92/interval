# Test environment kit

> PROVISIONAL (LLD practice batch 6b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Integration tests need a queue, a store and a clock, and which ones depends on where the
tests run. A local run uses in-memory pieces, CI uses containers, and staging uses the real
cloud services. Pieces from different environments must never be wired together: a CI
worker reading a staging queue is a bug that's hard to find. The kit makes every component
from one family at a time, so they always match.

| Family      | `queue`          | `store`            | `clock`          |
| ----------- | ---------------- | ------------------ | ---------------- |
| `"local"`   | `"inmem-queue"`  | `"sqlite-store"`   | `"fake-clock"`   |
| `"ci"`      | `"valkey-queue"` | `"postgres-store"` | `"fixed-clock"`  |
| `"staging"` | `"sqs-queue"`    | `"rds-store"`      | `"system-clock"` |

- `EnvKit()`: a kit with no family in use and no components.
- `use(family)`: makes components from that family from now on. A family not in the table
  (case matters) fails.
- `component(kind)`: makes a new component of that kind (`"queue"`, `"store"` or
  `"clock"`) from the family in use and returns its ID, `"<name>#<n>"`. `<name>` is the
  family's name for that kind in the table above, and `<n>` counts every component the
  kit has made, of any kind or family, from 1. For example, the kit's first component, a
  local queue, is `"inmem-queue#1"`. Any other kind fails, and so does making a component
  before any family is in use.
- `wire(a, b)`: whether the two components can be wired together: true when they come
  from the same family, false otherwise. A component stays in the family that made it,
  whichever family is in use later. Wiring a component to itself fails.
- `family(componentId)`: the family that made the component.

A component ID the kit didn't return fails, in `wire` and in `family`. A call that fails
changes nothing. Names and IDs are printable ASCII and case-sensitive, and there are at
most 10^4 calls.
