# Runner capabilities: draining (extension round)

> PROVISIONAL (LLD practice batch 5a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Runners get retired for upgrades, without killing the job they are running.

- `drain(name)`: the runner takes no new jobs. If it is idle it leaves the pool at once;
  otherwise it stays busy, still listed by `busy()`, and leaves the pool when its job
  finishes. Draining a runner that is already draining changes nothing. A name that isn't
  in the pool, or an empty one, fails.
- A runner that has left is no longer in the pool, so the name can be added again with
  `addRunner`, as a new runner after the others. While it is draining it is still in the
  pool, and adding the name fails.
