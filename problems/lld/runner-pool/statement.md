# Runner capabilities

> PROVISIONAL (LLD practice batch 5a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build the pool that hands CI jobs to runners. Each runner advertises only the capabilities
it really has, out of `"build"`, `"test"`, `"deploy"` and `"gpu"`. A job goes only to a
runner that has every capability it needs, never to one that would have to fake one.

- `RunnerPool()`: an empty pool.
- `addRunner(name, capabilities)`: adds an idle runner with these capabilities, after the
  runners already in the pool. The list may be empty and may repeat a capability. A name
  already in the pool, or an unknown capability, fails.
- `assign(job, needs)`: gives the job to the first runner, in the order the runners were
  added, that is idle and has every capability in `needs` (which may be empty or repeat
  one), and returns that runner's name. When no runner qualifies it returns null and the
  job isn't kept. A runner runs one job at a time. Assigning a job that is still running,
  or needing an unknown capability, fails.
- `finish(job)`: the job is done and its runner is idle again; returns true. False when
  the job isn't running.
- `busy()`: the names of the runners running a job, in ascending order by character code.

An empty runner or job name fails in every call. A call that fails changes nothing.
Runner and job names are separate (a job may share a runner's name), printable ASCII and
case-sensitive, at most 100 characters; capability lists have at most 100 entries; and
there are at most 10^4 calls.
