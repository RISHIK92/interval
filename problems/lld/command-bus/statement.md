# Ops command bus

> PROVISIONAL (LLD practice batch 8b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Operators send commands to services through a bus: each command is queued with an id,
the queue runs in order, and a retried submission must never run a command twice. Recent
changes can be taken back, newest first.

| Command  | `arg`           | Running it                              | Undoing it                     |
| -------- | --------------- | --------------------------------------- | ------------------------------ |
| `scale`  | `<service>=<n>` | sets the service's replica count to `n` | restores the count it replaced |
| `pause`  | `<service>`     | pauses the service                      | resumes it                     |
| `resume` | `<service>`     | resumes the service                     | pauses it again                |

`<n>` is a whole number from 0 to 1000 in decimal without leading zeros (`0` itself is
fine). A service name is not empty and has no `=`; in `scale` it is everything before the
first `=`. Every service starts with 0 replicas, not paused.

- `CommandBus()`: no services, nothing queued.
- `submit(id, command, arg)`: queues the command and returns true. Returns false,
  queueing nothing, when the id was used before by any command: queued, run or undone.
  An unknown command (case matters) or a malformed `arg` fails.
- `execute()`: runs every queued command in the order submitted, empties the queue, and
  returns the lines it added to the log. A command that **changes** something (a `scale`
  to a different count, a `pause` of a running service, a `resume` of a paused one) logs
  `"<id>: <command> <arg>"`. One that changes nothing logs `"<id>: skipped"` and can never
  be undone.
- `undoLast()`: undoes the most recent change that hasn't been undone yet, logs
  `"<id>: undone"` and returns its id; null when there is nothing to undo. An undone
  command can't be undone again.
- `replicas(service)`: 0 while the service is paused, otherwise its replica count. A
  service never mentioned has 0. Scaling a paused service changes the count it will have
  when it resumes.
- `log()`: every line logged so far, oldest first.

An empty id or service fails, in every call. Failing comes before returning false, and a
call that fails changes nothing. Ids, commands and arguments are printable ASCII and
case-sensitive, and there are at most 10^4 calls.

For example, after `submit("c1", "scale", "api=3")` and `submit("c2", "pause", "api")`,
`execute()` returns `["c1: scale api=3", "c2: pause api"]` and `replicas("api")` returns 0. `submit("c2", "resume", "api")` returns false: `c2` is taken. Then `undoLast()` returns
`"c2"`, and `replicas("api")` returns 3.
