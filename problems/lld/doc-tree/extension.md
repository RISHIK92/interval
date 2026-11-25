# Document tree: merging (extension round)

> PROVISIONAL (LLD practice batch 7c, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Overrides arrive as flat sets of settings to lay over one object in the document.

- `merge(path, entries)`: a shallow merge into the object at `path`: each entry's key is
  set to a scalar holding its value, whatever the key held before (a scalar, or a whole
  branch, which is replaced). Returns how many keys changed: added, or now holding a
  different value; a key whose scalar already had that value doesn't count.
  - A missing object at `path` is created first, exactly as `put` would create a node
    there. The root path `""` merges into the root.
  - It fails, changing nothing, when the node at `path` is a scalar or an array, when the
    object can't be created where `put` would return false, or when an entry has an
    invalid key or an empty value.
  - An empty `entries` returns 0 (still creating a missing object).
