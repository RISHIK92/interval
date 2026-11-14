# Task scheduler

> PROVISIONAL (P5-W34): written during the build; the owner reviews it before launch.

Build a scheduler that hands out tasks one at a time, highest priority first, once the
tasks they depend on are done.

- `TaskScheduler()`: starts empty.
- `add(id, priority, deps)`: adds a task. `id` is any string (the empty one too, and
  case matters); a higher `priority` runs first; `deps` lists the ids of tasks that must
  be done first (the same id twice is fine, and none is fine). The call fails, and
  changes nothing, when `id` is already used or when any of `deps` has not been added
  yet. A task can therefore only depend on earlier ones, so there are no cycles to
  check for.
- `next()`: picks the ready task with the highest priority, marks it running and returns
  its id. A task is ready when it is waiting to run and every one of its dependencies is
  done (a dependency that is only running isn't done). When several ready tasks share
  the highest priority, the one added first wins, whenever it became ready. Returns null
  when no task is ready.
- `complete(id)`: marks a running task done. Fails when `id` is unknown or its task is
  not running (waiting, ready or already done).
- `status(id)`: one of `"waiting"` (some dependency isn't done), `"ready"` (could be
  returned by `next` now), `"running"` or `"done"`. Fails when `id` is unknown.

Priorities are integers, negative ones too, within ±2^53. Ids are at most 100
characters.

Several threads may call at once (JavaScript and TypeScript: interleaved async calls).
Every call must see a consistent scheduler: a task is handed out by `next` once, and
two threads completing the same task must not both succeed.
