# Volume drivers

> PROVISIONAL (LLD practice batch D2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build a volume manager over storage drivers that support different optional operations.
Every driver can create volumes; beyond that, a driver supports only the operations it
advertises when it's registered, from `"snapshot"`, `"resize"` and `"encrypt"`. An
operation a volume's driver doesn't support **fails**: it never quietly does nothing.

- `VolumeManager()`: starts with no drivers and no volumes.
- `driver(name, ops)`: registers a driver with the operations in `ops`, which may be empty.
  An operation that isn't one of the three (case matters), an operation listed twice, or
  a name that's already registered fails. No call here uses `"encrypt"` yet, but drivers
  may advertise it.
- `create(volume, driver, sizeGb)`: creates a volume of `sizeGb` on the driver and returns
  true. An unknown driver fails. A volume name that's already taken returns false.
- `snapshot(volume)`: takes a snapshot of the volume (recording its current size) and
  returns its id: the volume's name, `@`, and the snapshot's number, counting from 1 for
  each volume (`"db@1"`, `"db@2"`, …). It needs the `"snapshot"` operation.
- `resize(volume, sizeGb)`: grows the volume to `sizeGb` and returns true. A size at or
  below the current one returns false and changes nothing: a volume never shrinks. It needs
  the `"resize"` operation.
- `snapshots(volume)`: the volume's snapshot ids, oldest first. It needs the `"snapshot"`
  operation too.

An unknown volume fails in every call but `create`, and an empty name fails in every
call. `sizeGb` outside 1 to 65536 fails. Failing comes before refusing: a `create` with a
taken volume name and an unknown driver or a bad size fails, and so does a `resize` to a
smaller size on a driver that can't resize. A call that fails changes nothing. Names are
printable ASCII and case-sensitive, and there are at most 10^4 calls.

For example, with a driver `"nfs"` advertising only `["resize"]`, a 10 GB volume on it
resizes to 11 (true) but not back to 5 (false), and `snapshot` of it fails.
