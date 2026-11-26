# Cache invalidation bus: keyspaces (extension round)

> PROVISIONAL (LLD practice batch 8c, Q-WD-30): drafted by Claude; the owner reviews it before launch.

The checkout nodes only ever cache orders, yet they flush everything when they come back
from a deploy because some user profile changed meanwhile. A node can now say which keys
it cares about.

- `keyspace(node, prefix)`: adds `prefix` to the node's keyspace, and returns how many
  cached entries it dropped. A node with no keyspace hears every key, as before. Once it
  has one, it holds only keys that start with one of its prefixes: entries outside the
  keyspace are dropped, so the first prefix may drop some and a later one never does.
  Adding a prefix it already has changes nothing. An empty prefix fails, and the node may
  be online or offline.
  - `cacheLocal` of a key outside the node's keyspace fails.
  - A node with a keyspace that comes back online empties its cache only if a write to a
    key in its keyspace happened while it was offline, judged against its keyspace when
    it comes back (prefixes added while it was offline count).
