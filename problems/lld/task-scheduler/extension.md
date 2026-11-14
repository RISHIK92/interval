# Task scheduler: cancelling (extension round)

> PROVISIONAL (P5-W34): written during the build; the owner reviews it before launch.

Plans change, so tasks can now be called off.

- `cancel(id)`: cancels the task and, transitively, every task that depends on it, and
  returns how many tasks it newly cancelled (the task itself counts, each task once).
  The task may be waiting, ready or running; a cancelled task's status is `"cancelled"`,
  `next` never returns it, and `complete` on it fails (it is not running).
- Fails when `id` is unknown or its task is already done (nothing changes). Cancelling
  an already cancelled task returns 0 and changes nothing.
- A task added afterwards that depends on a cancelled task is not cancelled: it just
  waits for a dependency that will never be done.
