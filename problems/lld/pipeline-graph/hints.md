> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

Because a job can only need jobs in earlier stages, what do you already know about every job it needs by the time a run reaches it?

## Approach

Model the two kinds of link differently. Ownership is containment: an ordered list of stages, each with its ordered list of jobs, plus an index from job to stage for uniqueness and lookups. Dependency is only names: each job keeps the list of jobs it needs. Since needs always point to earlier stages, a run is one pass in stage order that records each job's result in a map; a job's needs have all been decided by the time you reach it. Removing a stage first scans every other job's needs for one of the stage's jobs, and only then deletes the jobs and everything keyed by them.

## Code sketch

```text
class Pipeline
  stages: list of stage
  jobs: map stage -> list of job        // owned, in order
  stageOf: map job -> stage
  needs: map job -> list of job
  failing: set of job

  job(stage, name, needs) -> bool
    // TODO: fail on unknown stage or a repeated need
    // TODO: false if name exists or a need's stage isn't earlier
  run() -> list
    outcome: map job -> result
    // TODO: for each stage, each job, in order
    // TODO: skipped if any need's outcome is failed or skipped
    // TODO: else failed if in failing, else passed
  removeStage(name) -> int
    // TODO: fail if unknown or another stage's job needs one of its jobs
    // TODO: delete its jobs from every map; drop the stage
```
