# Disk quota

> PROVISIONAL (LLD practice batch A1, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build the quota for a shared volume with a byte limit. Owners (any printable ASCII string,
the empty one included) reserve space and release it. Two rules hold after every call: no owner holds
a negative amount, and the space held by all owners together never passes the limit.

- `DiskQuota(limitBytes)`: the volume's limit, 0 or more; a negative limit fails.
- `reserve(owner, bytes)`: adds `bytes` to the owner's space and returns true if it fits
  in what's free; otherwise returns false and changes nothing. Filling the volume exactly
  to its limit fits. `bytes` below 1 fails.
- `release(owner, bytes)`: gives `bytes` of the owner's space back. `bytes` below 1, or
  more than the owner holds, fails and changes nothing (an owner that never reserved
  anything holds 0).
- `used(owner)`: the bytes the owner holds, 0 for an unknown owner.
- `free()`: the limit minus everything held.

Limits and byte counts are below 2^53.
