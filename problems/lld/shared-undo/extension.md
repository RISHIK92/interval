# Collaborative undo: forced undo (extension round)

> PROVISIONAL (LLD practice batch 8d, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Sometimes a person knows their edit was wrong and wants it gone even though someone has
changed the key since. They can force the undo, and the history says so.

- `undoForce(user)`: undoes `user`'s newest edit that isn't undone, as `undo` does, but a
  conflict doesn't stop it: the key still gets back the value it had just before that edit,
  replacing whatever is there now. When there was a conflict, the history entry's action is
  `force` instead of `undo`; without one it's an ordinary undo. Like `undo`, the edit moves
  to the top of `user`'s redo list.
- It returns `false`, changing nothing, only when `user` has no edit to undo. A forced undo
  takes effect like any undo, so a later redo of the same edit conflicts only with changes
  made after it.
