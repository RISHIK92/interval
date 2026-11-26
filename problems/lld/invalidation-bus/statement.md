# Cache invalidation bus

> PROVISIONAL (LLD practice batch 8c, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Every app node keeps a local cache in front of a shared database. When a key is written,
the bus announces it, and every node that hears the announcement drops its cached copy,
so no node serves the old value. A node that is offline hears nothing. When it comes
back it can't know which keys changed while it was away, only whether anything did: if
any write happened, it empties its whole cache.

Writes are numbered by the bus: the first write is version `1`, the next `2`, and so on.

- `InvalidationBus()`: no nodes and no writes.
- `join(node)`: a new node, online, with an empty cache. A node that has already joined
  fails.
- `cacheLocal(node, key, val)`: the node caches `val` for `key`, replacing what it had.
- `write(key)`: the key has changed. Every online node drops its cached copy of the key.
  Returns the write's version.
- `cached(node, key)`: the node's cached value for the key, or null if it has none.
- `offline(node, down)`: `down` true takes the node offline, and false brings it back
  online. A node already in that state is unchanged. A node that comes back empties its
  cache if any write happened while it was offline, and keeps it otherwise.

`cacheLocal` and `cached` fail on a node that is offline: it can't be reached. Every
method that takes a node fails on one that hasn't joined. Nodes, keys and values are
printable ASCII and case-sensitive, and an empty one fails. A call that fails changes
nothing. There are at most 100 nodes and at most 10^4 calls.

For example, after `join("a")`, `cacheLocal("a", "user:1", "Ann")` and
`offline("a", true)`, a `write("user:2")` returns `1`, and when `a` comes back,
`cached("a", "user:1")` is null: `a` missed a write, so it couldn't trust `user:1`.
