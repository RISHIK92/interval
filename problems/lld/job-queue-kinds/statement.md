# Interchangeable job queues

> PROVISIONAL (LLD practice batch D2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build a job queue that comes in three kinds. Workers don't know which kind they're polling,
so every kind honours the same contract, and the tests run the same calls against all
three:

- `poll` only ever returns a **ready** job: one whose `notBeforeMs` is at or before `nowMs`.
- `size` counts **every** job in the queue, ready or not.
- A job that `poll` returned has left the queue for good.
- `peekAt(nowMs)` returns exactly what `poll(nowMs)` would return next, without removing it.

The kinds differ only in which ready job goes first:

| Kind         | First among the ready jobs                                    |
| ------------ | ------------------------------------------------------------- |
| `"fifo"`     | the one pushed earliest                                       |
| `"priority"` | the highest `priority`; equal priorities, the earliest pushed |
| `"delayed"`  | the lowest `notBeforeMs`; equal times, the earliest pushed    |

- `JobQueue(kind)`: an empty queue of that kind. Any other kind (case matters) fails.
- `push(job, priority, notBeforeMs)`: adds a job. Job names are unique for the queue's whole
  life: pushing a name the queue has ever accepted fails, even after that job was polled. A
  kind that doesn't order by priority or time still keeps both, and still won't return the
  job before `notBeforeMs`.
- `poll(nowMs)`: removes and returns the first ready job, or null when no job is ready.
- `peekAt(nowMs)`: the job `poll(nowMs)` would return, or null; it changes nothing.
- `size()`: the number of jobs in the queue.

`nowMs` need not increase from call to call: every call looks at the queue as it is, at the
time it's given. An empty job name fails, and so do `priority` outside 0 to 10^6 and
`notBeforeMs` or `nowMs` outside 0 to 10^12. A call that fails changes nothing. Job names
are printable ASCII and case-sensitive, and there are at most 10^4 calls.

For example, a `"priority"` queue with `("build", 1, 0)`, `("deploy", 5, 0)` and
`("report", 9, 1000)` polls `"deploy"` and then `"build"` at time 0, then null, with
`size()` 1, and `"report"` at time 1000.
