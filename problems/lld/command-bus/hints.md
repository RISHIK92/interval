> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If each command could take itself back, what would the bus need to keep in order to undo the last change?

## Approach

Turn each command into an object as soon as it's submitted: parsing and validating happen there, so a malformed one fails before its id is even looked at. Each kind of command has a `run` that applies it to a service and reports whether it changed anything (a scale also remembers the count it replaced), and an `undo` that reverses exactly that. The bus keeps a set of every id ever accepted, a queue of commands waiting to run, a stack of commands that changed something, and the log. Undo pops the stack and asks the command to reverse itself; skipped commands never reach the stack.

## Code sketch

```text
interface Command
  service
  run(svc) -> bool         // changed anything?
  undo(svc)
class Scale, Pause, Resume  // TODO: Scale keeps the old count

parse(command, arg) -> Command   // TODO: fail on anything malformed

class CommandBus
  services: map name -> (replicas, paused)
  ids: set, queue: list, done: stack, log: list

  submit(id, command, arg) -> bool
    // TODO: parse first, then the id check
  execute() -> list
    // TODO: run each in order; push the ones that changed
  undoLast() -> id or none  // TODO: pop, undo, log
  replicas(service) -> int  // TODO: 0 while paused
```
