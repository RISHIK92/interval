# Connection pool

> PROVISIONAL (LLD practice batch 6a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Opening a database connection is slow, so a service keeps the ones it has opened and lends
them out again. The pool opens a new connection only when none is free, never holds more
than its maximum at once, and throws away connections that turn out to be broken.

A connection is in one of three states: **held** by a client, **idle** in the pool, or
**discarded**. Held and idle connections both count towards the maximum; discarded ones
don't.

A client may hold any number of connections at once; its name is only checked, never
reported. In a real service many threads acquire at once, so a pool hands out each
connection under a lock and no connection ever goes to two clients; here calls arrive one
at a time, and a held connection is never lent again until it is released.

- `ConnPool(maxSize)`: an empty pool that may have up to `maxSize` connections at once.
  A `maxSize` below 1 or above 1000 fails.
- `acquire(client)`: lends a connection to `client` and returns its name. If any
  connection is idle, it lends the one that became idle most recently. If none is idle
  and the pool has fewer than `maxSize` connections, it opens a new one, named `conn-<n>`
  where `n` counts the connections the pool has opened, this one included (`conn-1`,
  `conn-2`, ...). Otherwise it returns null and nothing changes.
- `release(conn)`: a held connection becomes idle, and the call returns true. Releasing a
  connection that is idle or discarded is refused: false, and nothing changes.
- `invalidate(conn)`: discards a held or idle connection, freeing its place, and returns
  true. A discarded connection is never lent again. Invalidating a connection that is
  already discarded is refused: false.
- `created()`: how many connections the pool has opened, discarded ones included.
- `idle()`: how many connections are idle.

A name the pool never returned from `acquire` fails in `release` and `invalidate`, and
failing comes before refusing. An empty client fails. A call that fails changes nothing.
Clients and names are printable ASCII and case-sensitive, and there are at most 10^4
calls.
