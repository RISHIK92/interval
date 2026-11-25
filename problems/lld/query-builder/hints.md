> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If `where` wrote its value straight into the text it keeps, what could a value like `x' OR '1'='1` do to the query?

## Approach

Let each step record its own part and nothing more: the selected columns, a list of condition texts with a parallel list of values, the ordering terms, the limit. Check every identifier against one plain-name rule at the moment it arrives, and give each value a placeholder numbered by how many values there are once it's added, so the text only ever holds names you checked and `$k` markers. Assembly happens only in `build`, which writes the clauses in SQL's fixed order and leaves out the ones that are empty, so the order of the calls never matters.

## Code sketch

```text
class QueryBuilder
  table, columns = []
  conditions = [], values = []
  order = [], ordered = set()
  limit = none

  constructor(table)       // TODO: plain name only
  columns(cols)
    // TODO: fail on empty, repeats, non-plain
  where(column, op, val)
    // TODO: check column, op, val
    // TODO: keep val; add "<column> <op> $<count>"
  orderBy(column, desc)
    // TODO: each column once; ASC or DESC
  limit(n)                 // TODO: 1..10^9, replaces
  build() -> string
    // TODO: SELECT ... FROM ...
    // TODO: then WHERE, ORDER BY, LIMIT if present
  params() -> list
```
