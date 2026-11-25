# SQL query builder: joins (extension round)

> PROVISIONAL (LLD practice batch 6b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Reports need columns from more than one table.

- `innerJoin(table, leftColumn, rightColumn)`: joins `table` on
  `<query's table>.<leftColumn> = <table>.<rightColumn>`. `build()` puts each join right
  after `FROM <table>`, in the order they were added, as
  ` INNER JOIN <table> ON <query's table>.<leftColumn> = <table>.<rightColumn>`.
  - All three must be plain names. Joining the query's own table, or a table already
    joined, fails.
- Nothing else changes: columns, conditions and ordering use plain names as before.

For example, on `orders`, `innerJoin("users", "user_id", "id")` makes the build start
`"SELECT * FROM orders INNER JOIN users ON orders.user_id = users.id"`.
