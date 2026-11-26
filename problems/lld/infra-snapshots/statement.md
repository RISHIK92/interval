# Infra state snapshots

> PROVISIONAL (LLD practice batch 8c, Q-WD-30): drafted by Claude; the owner reviews it before launch.

An infrastructure tool keeps the state of every resource it manages: a name and its
attributes. Before a risky change, operators snapshot the state under a label, and they
can put it back exactly, or ask what has changed since.

- `InfraState()`: no resources and no snapshots.
- `apply(resource, attrs)`: the resource's attributes become exactly `attrs`, creating
  the resource if it doesn't exist. Attributes it had that aren't in `attrs` are gone. An
  empty `attrs` is allowed: the resource exists with no attributes.
- `destroy(resource)`: removes the resource and returns `true`, or returns `false` if it
  doesn't exist.
- `snapshot(label)`: records the whole current state and returns the snapshot's id. Ids
  are `1`, `2`, `3`, and so on, in the order snapshots are taken, and are never reused.
  A label belongs to one snapshot at a time: taking a snapshot under a label already in
  use deletes the older snapshot with that label.
- `restore(snapshotId)`: makes the current state exactly what the snapshot recorded and
  returns `true`, or returns `false` if there is no snapshot with that id (never taken,
  or deleted). The snapshot is kept, so it can be restored again, and later changes to
  the state never change it.
- `diffSince(snapshotId)`: what has changed between the snapshot and now, one line per
  resource that differs, sorted by resource name:
  - `"+ <resource>"`: it exists now but not in the snapshot.
  - `"- <resource>"`: it is in the snapshot but doesn't exist now.
  - `"~ <resource>: <keys>"`: it exists in both with different attributes. `<keys>` are
    the attributes added, removed or given a different value, sorted and joined with
    commas.

  A snapshot that doesn't exist fails.

Resources, attribute names, attribute values and labels are printable ASCII and
case-sensitive, and an empty one fails. Sorted means by character code. A call that fails
changes nothing. A resource has at most 20 attributes, there are at most 100 resources
and 100 snapshots at a time, and there are at most 10^4 calls.

For example, after `apply("vm", {"size": "s"})`, `snapshot("before")` returns `1`. After
`apply("vm", {"size": "m", "disk": "ssd"})` and `apply("db", {})`, `diffSince(1)` returns
`["+ db", "~ vm: disk,size"]`.
