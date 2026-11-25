> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If every driver had a `snapshot` method whether it could snapshot or not, what would the ones that can't do when it's called, and how would the manager tell?

## Approach

Split the optional operations into narrow capabilities, one per operation: a snapshotting one that numbers and records snapshots on a volume, and a resizing one that only ever grows it. A driver is built from its list of operations and holds just the capability objects it has, with nothing for the ones it lacks. The manager depends only on those capability types: for a call, it finds the volume, asks its driver for the capability the call needs, and fails when there's none. Each volume keeps its size and its snapshots in order, with the size each one recorded.

## Code sketch

```text
class Volume(name, size, snapshots: ordered map id -> size)

class Snapshots   // the "snapshot" capability
  take(volume) -> string   // TODO: id = name@(count+1); record size
class Resizing    // the "resize" capability
  grow(volume, size) -> bool   // TODO: only when larger

class Driver(ops)
  // TODO: fail on unknown or repeated ops
  snapshots: optional<Snapshots>; resizing: optional<Resizing>

class VolumeManager
  drivers: map name -> Driver; volumes: map name -> (Volume, Driver)
  driver(name, ops)          // TODO: fail on "" or a taken name
  create(volume, driver, sizeGb) -> bool
    // TODO: fail first (names, driver, size); then refuse a taken name
  snapshot(volume) / snapshots(volume)
    // TODO: find the volume; fail without Snapshots; delegate
  resize(volume, sizeGb) -> bool
    // TODO: find; fail without Resizing or on size bounds; grow
```
