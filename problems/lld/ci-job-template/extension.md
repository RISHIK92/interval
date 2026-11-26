# CI job template: before every step (extension round)

> PROVISIONAL (LLD practice batch 8a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Platform wants every step of every job wrapped: a timestamp, a disk check, a log marker.

- `beforeEach(command)`: from now on, before every step a job runs (for every kind, in
  `steps` and in `runJob`), the job runs this command and writes the line
  `"before <step>: <command>"`. Commands added by several calls all run before each step,
  in the order they were added; adding the same command twice runs it twice.
  - These commands never fail, and a step that doesn't run has none run for it. Report
    gets them too, after a failure as well.
  - An empty command fails. Commands are printable ASCII and case-sensitive, they're kept
    exactly as given, spaces and all, and at most 100 are added.
