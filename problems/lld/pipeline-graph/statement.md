# CI pipeline graph

> PROVISIONAL (LLD practice batch A3, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build the model of a CI pipeline. A pipeline owns its stages, in the order they were
added, and each stage owns its jobs, in the order they were added to it. A job may need
other jobs, but only jobs in earlier stages: it depends on them without owning them.

Job names are unique across the whole pipeline. Removing a stage removes its jobs, and
their names are free again.

- `Pipeline()`: starts with no stages.
- `stage(name)`: adds a stage after every existing one. A stage name already in use
  fails.
- `job(stage, name, needs)`: adds the job `name` at the end of `stage`, needing each job
  in `needs` (possibly none), and returns true. It returns false and changes nothing when
  a job named `name` already exists in any stage, or when any of `needs` isn't a job in a
  stage before `stage` (an unknown job, one in the same stage, or one in a later stage).
  An unknown stage, or the same name twice in `needs`, fails.
- `fail(job)`: marks the job to fail whenever it runs, in this run and every later one.
  Marking it again changes nothing. An unknown job fails.
- `run()`: runs the pipeline and returns one line per job, stage by stage in order and
  within a stage in the order the jobs were added: `<job>: passed`, `<job>: failed` or
  `<job>: skipped`. A job is skipped, without running, when any job it needs failed or was
  skipped. A job that runs fails if it's marked to fail, and passes otherwise. Running
  changes nothing, so the same pipeline gives the same lines until it changes.
- `removeStage(name)`: removes the stage, its jobs and their marks, and returns how many
  jobs it had. It fails and changes nothing while any job in another stage needs one of
  its jobs. An unknown stage fails.

A stage and a job may share a name. An empty stage or job name fails in every call. A call that fails changes nothing, and failing comes first: a call that breaks one of these rules fails even when it would otherwise have returned false. Names are printable ASCII and case-sensitive. There are at most 10^3 jobs, at most 100 names in one `needs`,
and at most 10^4 calls.
