# Ops command bus: scheduled commands (extension round)

> PROVISIONAL (LLD practice batch 8b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Some changes are planned: scale up before the morning peak, pause a batch service for
the night.

- `schedule(id, command, arg, atMs)`: like `submit`, but the command waits for its time
  instead of joining the queue. Ids are shared with `submit`: an id used by either is
  taken for both. Returns true, or false when the id is taken. A negative `atMs` fails,
  and so does anything `submit` fails on.
- `executeDue(nowMs)`: runs every scheduled command with `atMs <= nowMs` that hasn't run
  yet, earliest `atMs` first and, at the same time, in the order scheduled. Returns the
  lines it logged, exactly as `execute` would log them. A negative `nowMs` fails. Times are at most 10^12.
  - `execute()` never runs scheduled commands, and `executeDue` never runs queued ones.
  - Changes made by scheduled commands join the same undo history as all the others.
