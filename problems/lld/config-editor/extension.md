# Config edits with undo: batches (extension round)

> PROVISIONAL (LLD practice batch 8a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A rollout changes several keys together, and rolling it back must change them all back.

- `batch(ops)`: makes several edits as one. Each entry is `"<op> <key> <val>"`: the op
  runs up to the first space and the key up to the second, and everything after the
  second space is the value, spaces and all (so `"put mode "` sets `mode` to the empty
  string). The entries are done in order, each on the config the ones before it left,
  with the ops, effects and refusals of the table.
  - An entry that's refused is skipped. If every entry is refused (or the list is empty),
    the batch returns false and changes nothing, just like a refused `apply`.
  - Otherwise it returns true, and the batch is one edit: one `undo()` undoes all of its
    entries, putting the config back exactly as it was before the batch, and one
    `redo()` makes them all again. As with `apply`, nothing can be redone after it.
  - An entry without two spaces, with an op not in the table, or with an empty key fails
    the whole batch, before any entry is done.
  - A batch has at most 100 entries.
