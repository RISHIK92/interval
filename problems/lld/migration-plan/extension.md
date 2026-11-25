# Schema migration plan: irreversible migrations (extension round)

> PROVISIONAL (LLD practice batch C2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Some migrations drop data, so there's no going back across them.

- `irreversible(version)`: marks a planned version, applied or pending, as irreversible.
  Marking it again changes nothing. A version that isn't planned fails.
- A `rollback` that would undo an irreversible migration fails, with nothing undone, even
  when it would undo others first. A rollback that stops just above it is fine.
- Applying is unaffected: an irreversible migration that is pending applies as usual.
