# Document tree

> PROVISIONAL (LLD practice batch 7c, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A configuration document is a tree, like JSON: **objects** map keys to child nodes,
**arrays** hold child nodes in order, and **scalars** are string leaves. The document's
root is always an object. Every node, branch or leaf, answers the same few questions, so
callers never need to know which kind they're holding.

**Paths.** A path names a node: a key, followed by any number of `.key` (into an object)
and `[index]` (into an array), as in `svc.ports[1]` or `a.b[2].c`. A key is one or more
ASCII letters, digits, `_` and `-`. An index is a decimal number without leading zeros
(`0`, `7`, `12`, never `07`). The empty path `""` is the root. A path written any other
way fails, in every call.

- `DocTree()`: an empty root object.
- `put(path, val)`: sets the scalar at `path` to `val` and returns true, creating any
  missing nodes on the way. A missing node is created as an object when the segment after
  it is a key and as an array when it's an index. It returns false, changing nothing, when:
  - a segment doesn't fit the node it steps into: a key into an array or a scalar, or an
    index into an object or a scalar;
  - an index would leave a gap: an array only grows at its end, so a new item's index must
    equal the array's current length (a new array's first item is `[0]`);
  - the node at `path` is an object or an array: `put` only replaces scalars.

  The root path, or an empty `val`, fails, and failing comes before refusing.

- `read(path)`: a scalar's value, or a branch's summary: `"object(<n>)"` with its number
  of keys, `"array(<n>)"` with its number of items. `null` when there's no node there,
  including a path that steps into the wrong kind.
- `remove(path)`: removes the node and everything under it and returns true. In an array,
  the items after it move down one index. Branches left empty stay. False, changing
  nothing, when there's no node there. The root path fails.
- `paths(prefix)`: the paths of every scalar under the node at `prefix` (the node itself
  if it's a scalar), in document order: an object's keys in character-code order, an
  array's items by index, each subtree before the next. Each path is written in full,
  starting with `prefix`. Empty branches give no paths. `[]` when there's no node there.
- `count(path)`: how many nodes are under the node at `path`, at every depth, branches and
  scalars alike, not counting the node itself (0 for a scalar). No node there fails.

A call that fails changes nothing. Values are printable ASCII. Paths are at most 100
characters, indexes at most 999, and there are at most 10^4 calls.

For example, after `put("svc.ports[0]", "80")` and `put("svc.name", "api")`,
`read("svc")` returns `"object(2)"`, `paths("")` returns `["svc.name", "svc.ports[0]"]`
and `count("")` returns 4.
