> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

What does an edit need to remember so that it can be taken back safely?

## Approach

Make each edit a command object that keeps a memento of its key's value just before it ran (possibly no value) alongside the new value, so undo and redo are just "write before" and "write after". Each user gets their own undo stack and redo stack of these commands. Keep one log of changes per key, each with the user who made it; it gives the history, and it answers the conflict question: when a command is applied, remember how long its key's log was, and a later undo or redo conflicts if any entry after that point belongs to someone else. Every edit, undo and redo goes through one write method that sets the value, appends to the log and stamps the command.

## Code sketch

```text
class Edit
  user, key, before (optional), after
  at                                   // the key's log length when last applied

class SharedDoc
  values: map key -> string
  log: map key -> list of (user, entry)
  undos, redos: map user -> list of Edit

  edit(user, key, val)                 // TODO: new Edit, write, push, clear redos
  undo(user) -> bool                   // TODO: top of undos; refuse on conflict
  redo(user) -> bool                   // TODO: top of redos; refuse on conflict
  value(key) -> optional string        // TODO
  history(key) -> list of string       // TODO: entries from the log

  conflicts(command) -> bool           // TODO: a later log entry by someone else?
  write(command, action, val)          // TODO: set or clear, log, stamp `at`
```
