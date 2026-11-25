> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If each kind had its own poll, its own peek and its own size, how sure could you be that all three kept "peek predicts poll" and "only ready jobs leave"?

## Approach

Write the contract once, in a base queue that holds the jobs by name and does the shared work: filter to the ready jobs, pick the first, remove it on a poll, count them for size. Peek and poll call the same "first ready job" step, so they can't disagree. Each kind is a subclass that overrides one thing only: an ordering key for a job, with the push sequence number as the tie-breaker. The queue the caller sees picks the subclass from the kind at construction, checks the arguments and the used names, and hands each job a sequence number.

## Code sketch

```text
record Job(name, priority, notBefore, seq)

abstract class Queue
  jobs: map name -> Job
  abstract order(job) -> key           // smallest key goes first
  peek(now) -> optional<Job>
    // TODO: the ready job (notBefore <= now) with the smallest key
  poll(now) -> optional<Job>
    // TODO: peek(now), then remove it
  size() -> int

class FifoQueue / PriorityQueue / DelayedQueue extends Queue
  order(job)  // TODO: (seq) / (-priority, seq) / (notBefore, seq)

class JobQueue
  queue, used: set of names
  constructor(kind)  // TODO: fail on an unknown kind
  push(job, priority, notBeforeMs)
    // TODO: fail on "", a used name or bounds; seq = count so far
  poll / peekAt / size  // TODO: check nowMs, then delegate
```
