# Collaborative undo

> PROVISIONAL (LLD practice batch 8d, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Several people edit one shared key-value document, such as a runbook's settings. Undo has
to work per person: your undo takes back your own last edit, even when others have edited
since. But it must never wipe out someone else's work, so an undo conflicts, and is
refused, when someone else has changed the same key since your edit.

- `SharedDoc()`: an empty document. No key has a value.
- `edit(user, key, val)`: sets `key` to `val`. It becomes `user`'s newest edit, and it
  clears `user`'s redo list (no one else's).
- `undo(user)`: takes back `user`'s newest edit that isn't undone: the key gets back the
  value it had just before that edit (no value, if it had none). The edit moves to the top
  of `user`'s redo list. Returns `false`, changing nothing, when `user` has no edit to undo
  or the undo conflicts.
- `redo(user)`: applies the top of `user`'s redo list again: the key gets that edit's
  `val`, and it's `user`'s newest edit to undo again. Returns `false`, changing nothing, when
  the redo list is empty or the redo conflicts.
- `value(key)`: the key's value, or `null` when it has none.
- `history(key)`: every change to the key, oldest first, as `"<action>:<user>:<value>"`,
  where `<action>` is `edit`, `undo` or `redo` and `<value>` is the key's value after the
  change (empty when the key has no value). A key that never changed gives `[]`.

**Conflicts.** An undo or redo of an edit conflicts when a user other than the edit's own
changed its key (by an edit, undo or redo) after the edit last took effect. An edit takes
effect when it's made, when it's undone and when it's redone. Changes by the same user
never conflict, and changes to other keys don't matter.

Names and values are printable ASCII and case-sensitive; an empty one fails, and
a user name with a `:` fails too. A call that fails changes nothing. There are at most
10^4 calls.

For example, after `edit("ann", "port", "80")` and `edit("bo", "host", "a")`,
`undo("ann")` returns `true` and `value("port")` returns `null`. Had `bo` instead run
`edit("bo", "port", "81")`, `undo("ann")` would return `false`.
