> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If a snapshot held a reference to the live attribute maps instead of its own copy, what would `apply` after `snapshot` do to it?

## Approach

Treat each snapshot as a memento: an object holding its label and a deep copy of every resource's attributes, taken when it's made and copied again when it's read back, so neither later changes nor a restore followed by changes can reach it. The state class is the only one that makes or reads mementos; it keeps them in a map from id with a counter for the next id, and drops any older one with the same label before storing a new one. Restoring replaces the current resources with the memento's copy. A diff walks the union of resource names in sorted order, and for a resource present on both sides, the union of attribute names whose values differ (a missing key counts as different from any value).

## Code sketch

```text
class Snapshot                     // the memento
  label
  resources: map name -> map key -> value   // a deep copy
  copy() -> resources                       // TODO: deep copy out

class InfraState
  resources: map name -> map key -> value
  snapshots: map id -> Snapshot
  lastId = 0

  apply(resource, attrs)            // TODO: validate, replace
  destroy(resource) -> bool         // TODO
  snapshot(label) -> int            // TODO: drop same label, store a copy
  restore(snapshotId) -> bool       // TODO: current = snapshot.copy()
  diffSince(snapshotId) -> list
    // TODO: for each name in the sorted union
    //   "+ name", "- name", or "~ name: k1,k2" for differing keys
```
