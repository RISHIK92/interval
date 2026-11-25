# CI pipeline graph: allowed failures (extension round)

> PROVISIONAL (LLD practice batch A3, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Some jobs, such as a flaky lint or an optional benchmark, shouldn't hold the pipeline up.

- `allowFailure(job)`: the job's failure is allowed from now on. When it fails, its line
  still reads `<job>: failed`, but the jobs that need it treat it as passed and run.
  Allowing it again changes nothing. An unknown or empty job fails.
- An allowed failure doesn't stop a job being skipped: if something it needs failed (and
  isn't allowed to) or was skipped, it's skipped, and the jobs that need it are skipped
  too.
- Removing the job's stage removes its allowance with it.
