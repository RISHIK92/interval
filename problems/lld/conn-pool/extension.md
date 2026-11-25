# Connection pool: shrinking (extension round)

> PROVISIONAL (LLD practice batch 6a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

After a traffic spike the pool sits on idle connections the database would like back.

- `shrink(maxIdle)`: closes idle connections until at most `maxIdle` are idle, and returns
  how many it closed. It closes the ones that have been idle longest, so the most recently
  released ones stay. A closed connection is discarded, exactly as if it had been
  invalidated: it frees its place and is never lent again.
- Held connections are never touched, and when no more than `maxIdle` are idle it closes
  nothing and returns 0.
- A negative `maxIdle` fails.
