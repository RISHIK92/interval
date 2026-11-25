# Volume drivers: restoring a snapshot (extension round)

> PROVISIONAL (LLD practice batch D2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Operators want to roll a volume back to one of its snapshots.

- `restore(volume, snapshot)`: puts the volume back to the snapshot and returns true. The
  volume's size becomes the size the snapshot recorded, even when that's smaller (a restore
  isn't a resize), so later resizes compare against that size. The volume keeps all its
  snapshots, and the next one is still numbered after the last. It returns false when
  `snapshot` isn't one of this volume's snapshots, including another volume's.
- Like the other snapshot calls, it needs the `"snapshot"` operation: on a volume whose
  driver doesn't advertise it, it fails. An unknown volume or an empty snapshot id fails.

For example, a 10 GB volume `"db"` with a snapshot `"db@1"`, then resized to 40, can be
resized to 20 again after `restore("db", "db@1")`.
