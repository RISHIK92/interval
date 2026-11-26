> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

Which parts of a job are the same for every language, and where should those rules live so a fourth language can't get them wrong?

## Approach

Write one base job class whose run method is the template: it walks the five steps in order, asks the kind for each step's command through a method, and owns every rule about skipping, failing and always reporting. Checkout and report are written once in the base class, test is abstract, and setup and install are hooks whose default is no step at all. Each language is a subclass that overrides only the commands it has. The runner keeps what's shared across kinds, the skipped steps, picks the subclass from a table by kind, and calls its run. steps is just a run in which nothing fails.

## Code sketch

```text
abstract class Job
  checkout() -> "git checkout"
  setup() -> optional<string>     // hook: none by default
  install() -> optional<string>   // hook: none by default
  abstract test() -> string
  report() -> "publish results"

  run(skipped, failAt) -> list<string>     // the template
    // TODO: for each step in order, with its command:
    // TODO:   none, skipped, or failed already (unless report)? next
    // TODO:   line "<step>: <command>", " [failed]" if failAt

class NodeJob, PythonJob, GoJob extends Job

class JobRunner
  skipped: set
  steps(kind) -> list<string>     // TODO: run with nothing failing
  skip(step)                      // TODO: only setup or install
  runJob(kind, failAt) -> list<string>
    // TODO: fail on unknown kind or failAt; then run
```
