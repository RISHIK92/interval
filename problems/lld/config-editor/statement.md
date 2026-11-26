# Config edits with undo

> PROVISIONAL (LLD practice batch 8a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

An editor for a service's key-value config. Every change can be undone and redone, the
way a text editor's can, and a new change after an undo throws away what could have been
redone.

| Op         | Effect                                      | Refused (returns false) when                      |
| ---------- | ------------------------------------------- | ------------------------------------------------- |
| `"put"`    | sets the key to `val`, adding it if missing | the key already has exactly `val`                 |
| `"remove"` | removes the key; `val` is ignored           | the key isn't there                               |
| `"append"` | adds `val` to the end of the key's value    | the key isn't there, or `val` is the empty string |

- `ConfigEditor()`: an empty config, with nothing to undo or redo.
- `apply(op, key, val)`: makes an edit from the table (case matters) and returns true. The
  edit can then be undone, and nothing can be redone until something is undone again.
  An edit that's refused returns false and changes nothing: it can't be undone, and what
  could be redone still can. An op not in the table, or an empty key, fails. `val` may be
  empty.
- `undo()`: undoes the latest edit that hasn't been undone, putting the config back
  exactly as it was before that edit, and returns true. It can then be redone. Returns
  false when there's nothing to undo.
- `redo()`: makes the edit undone most recently again and returns true; it can then be
  undone again. Returns false when there's nothing to redo.
- `view()`: the config as a map from key to value.

A call that fails changes nothing. Keys and values are printable ASCII and
case-sensitive, values are kept exactly as given, spaces and all, there are at most 100
keys, no value (as given or as built by appends) is longer than 10^4 characters, and
there are at most 10^4 calls.

For example, after `apply("put", "host", "db1")` and `apply("append", "host",
".internal")`, `view()` is `{"host": "db1.internal"}`. `undo()` makes it `{"host":
"db1"}`, and a second `undo()` makes it `{}`. `redo()` then brings back `{"host":
"db1"}`.
