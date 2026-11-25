# SQL query builder

> PROVISIONAL (LLD practice batch 6b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Hand-written SQL strings are where injection bugs come from. Build a SELECT step by step
instead: each call adds one part, and the builder puts the parts together in SQL's order,
whatever order they were added in. Values never go into the SQL text. Each becomes a
numbered placeholder, and the values are handed over separately.

A **plain name** is a letter or `_`, then any letters, digits or `_` (letters are `A` to
`Z` and `a` to `z`). Tables and columns must be plain names, so nothing that names them can
smuggle in SQL.

- `QueryBuilder(table)`: a query on `table`, which must be a plain name.
- `columns(cols)`: selects these columns, in this order, replacing any earlier selection.
  An empty list, a column listed twice, or one that isn't a plain name fails. Until it's
  called, the query selects `*`.
- `where(column, op, val)`: adds the condition `<column> <op> $<k>`, where `<k>` is the
  number of values added so far, this one included (so the first is `$1`), and `val` is
  kept as that value. Conditions are joined with `AND`, in the order they were added. `op`
  is one of `=`, `<>`, `<`, `<=`, `>`, `>=` and `LIKE` (case matters); anything else
  fails, and so does an empty `val`.
- `orderBy(column, desc)`: adds `<column> DESC` when `desc` is true, otherwise
  `<column> ASC`. Terms are joined with `, ` in the order they were added. Ordering by a
  column already ordered by fails.
- `limit(n)`: limits the query to `n` rows, from 1 to 10^9, replacing any earlier limit.
  Anything else fails.
- `build()`: the SQL for the query as it is now:
  `SELECT <columns> FROM <table>`, then ` WHERE <conditions>` if there are any, then
  ` ORDER BY <terms>` if there are any, then ` LIMIT <n>` if a limit was set. Columns are
  joined with `, `. The builder can keep changing after a build, and build again.
- `params()`: the values, in placeholder order.

A column that isn't a plain name fails in every call. A call that fails changes nothing.
Every string is printable ASCII and case-sensitive, and there are at most 10^4 calls.

For example, on `users`, after `columns(["id", "email"])`, `where("age", ">=", "18")`,
`where("name", "LIKE", "A%")`, `orderBy("created_at", true)` and `limit(10)`, `build()`
returns
`"SELECT id, email FROM users WHERE age >= $1 AND name LIKE $2 ORDER BY created_at DESC LIMIT 10"`
and `params()` returns `["18", "A%"]`.
