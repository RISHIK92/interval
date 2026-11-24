> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

When two ready tasks share the top priority, which one should `next` return, and what must you remember about every task to decide?

## Approach

Store every task in the order it was added, with its priority, its dependency ids and a state (queued, running, done). Readiness is decided when asked: a task is ready when it is queued and every dependency is done (running is not enough). `next` scans all tasks for the ready one with the highest priority, keeping the earliest added on a tie, and marks it running. One lock makes sure `next` hands each task out once and only one `complete` wins.

## Code sketch

```text
class TaskScheduler
  tasks: map id -> (priority, deps, state), in order of adding
  lock

  ready(task) -> bool
    // TODO: queued, and every dependency is done
  add(id, priority, deps)
    // TODO: fail on a used id or an unknown dependency; store it queued
  next() -> optional<string>
    // TODO: the ready task with the highest priority, earliest added on a tie
    // TODO: mark it running and return its id; null when none is ready
  complete(id)
    // TODO: fail unless the task is running; mark it done
  status(id) -> string
    // TODO: "waiting" or "ready" for a queued task, else its state; unknown fails
```
