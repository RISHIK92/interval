> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If undo had to work out how to reverse each kind of edit on its own, what would it need to know that only the edit knew when it ran?

## Approach

Make every edit a command object with two methods, do and undo, built from the op, key and value. When it's done, a command remembers the key's value from before (or that it was missing), so undoing any kind of edit just puts that back. Keep two stacks of commands: undo pops from the done stack, undoes, and pushes onto the undone stack; redo does the reverse. A successful new edit goes on the done stack and empties the undone stack. A refused edit never becomes a command on either stack, so check refusals before doing anything.

## Code sketch

```text
abstract class Edit(key, val)
  before: optional<string>
  refused(config) -> bool          // TODO: per kind
  change(config)                   // TODO: per kind
  do(config)                       // TODO: before = config[key]; change
  undo(config)                     // TODO: restore before, or remove key

class Put, Remove, Append extends Edit

class ConfigEditor
  config: map; done: stack; undone: stack

  apply(op, key, val) -> bool
    // TODO: build the Edit (fail on unknown op or "")
    // TODO: refused? false; else do, push on done, clear undone
  undo() -> bool
    // TODO: pop done, undo, push on undone
  redo() -> bool
    // TODO: pop undone, do, push on done
  view() -> map<string,string>
```
