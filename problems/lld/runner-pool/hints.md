> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If every runner had to implement build, test, deploy and gpu, what would a build-only runner do when a job asks it to deploy?

## Approach

Let a runner carry only the set of capabilities it has, plus the job it is running. The pool keeps its runners in the order they were added and a map from each running job to its runner. To assign, check the needs are all known, then walk the runners in order and take the first idle one whose capabilities contain every need; nothing ever asks a runner for something outside its set. Finishing removes the job from the map and clears the runner's job; `busy` is the map's runners, sorted.

## Code sketch

```text
KNOWN = { build, test, deploy, gpu }

class Runner
  capabilities  // a set
  job           // null when idle
  takes(needs) -> bool
    // TODO: idle, and needs is a subset of capabilities

class RunnerPool
  runners  // in the order added
  jobs     // job -> runner

  addRunner(name, capabilities)
    // TODO: fail on empty, taken name, unknown capability
  assign(job, needs) -> optional<string>
    // TODO: fail on empty, unknown need, running job
    // TODO: the first runner that takes it, or null
  finish(job) -> bool
    // TODO: false if not running; free its runner
  busy() -> list
```
