# Account provisioning saga: a pivot step (extension round)

> PROVISIONAL (LLD practice batch 8d, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Once access is granted, the customer may already be using the account, and tearing it down
would hurt more than a late welcome email. Past that point the saga should only move
forward.

- `pivot(step)`: makes `step` the pivot, replacing any earlier pivot. A step that isn't one
  of the four fails.
- From then on, when a step fails while the pivot step is done in that saga, nothing is
  undone: the run stops with the new status `"pending"`, the failure still adds
  `"fail:<step>"` to the trail, and the done steps stay done. A step failing while the
  pivot isn't done (the pivot step itself included) compensates as before.
- `retry` runs a `"pending"` saga as it runs any other: it skips the done steps, so it
  resumes at the step that failed. The pivot that counts is the one in place when a step
  fails, so moving the pivot also changes what a pending saga's next failure does.
