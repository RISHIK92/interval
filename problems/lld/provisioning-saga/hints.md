> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If each saga remembers which steps it has done, what does a retry need to know to carry on safely?

## Approach

Make each step a command with two operations, do and undo, each returning the line it adds to the trail; the step also holds its scripted failure count, shared by every account. Each account's saga keeps its own list of done steps (always the first few, in order), its trail and its status. Running a saga walks the steps after the done ones: a success appends the step to the done list, a failure undoes the done list newest first and clears it. Because a run only ever looks at what isn't done, a start, a retry after compensation and a retry of a completed saga are the same loop.

## Code sketch

```text
class Step
  name, failures = 0
  execute() -> string        // TODO: "do:<name>", or use a failure: "fail:<name>"
  compensate() -> string     // TODO: "undo:<name>"

class Saga
  done: list of Step, trail: list of string, status
  resume(steps)              // TODO: run the steps after the done ones
  failed()                   // TODO: undo done steps newest first, clear them

class ProvisioningSaga
  steps: the four Steps in order
  sagas: map account -> Saga

  failStep(step, times)      // TODO: validate, replace the count
  start(account) -> string   // TODO: new Saga and resume, or the existing status
  retry(account) -> string   // TODO: resume the existing saga
  trail(account) -> list     // TODO
  status(account) -> string  // TODO
```
