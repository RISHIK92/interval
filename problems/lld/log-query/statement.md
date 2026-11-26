# Log query language

> PROVISIONAL (LLD practice batch 8d, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Structured log records are maps from field names to values. Build a small piped query
language over them, the kind a log search box offers: a source, then stages that each take
the rows from the stage before.

```text
logs | where status >= 500 | count service | sort count desc | top 3
```

A query is split on `|`, and each part into words separated by one or more spaces (spaces at either end of a part are ignored). The first part is
the source, exactly one word: `logs`, every ingested record in ingestion order. Each later
part is one stage:

| Stage                                                   | What it does                                                                                                                                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `where <field> <op> <value>`                            | Keeps the rows that have the field and whose value compares to `<value>` as `<op>` says. `<op>` is `=`, `!=`, `<`, `<=`, `>` or `>=`.                                                                                    |
| `count <field>`                                         | One row per distinct value of the field (exact text) among the rows that have it, in order of first appearance, with two fields: the field, and `count`, the number of rows with that value. `<field>` can't be `count`. |
| `sort <field>`, `sort <field> asc`, `sort <field> desc` | Sorts the rows that have the field by its value, ascending unless `desc`. Rows that compare equal keep their order, and rows without the field follow, in their order.                                                   |
| `top <n>`                                               | Keeps the first `n` rows. `n` is at most 5 decimal digits, with a value from 1 to 10^4.                                                                                                                                  |

**Comparing values.** One order serves `where` and `sort`. An integer is an optional `-`
and 1 to 9 decimal digits. Two integers compare by value (`"007"` equals `"7"`), an integer
comes before every value that isn't one, and other values compare by character code.

- `LogQuery()`: no records.
- `ingest(fields)`: adds a record. An empty map, an empty value or a bad field name fails.
- `run(query)`: the rows the query ends with, each as its fields sorted by name (by
  character code), written `name=value` and joined by single spaces:
  `"count=2 service=api"`.
- `explainQuery(query)`: one line per stage without running anything: `source logs`, then
  each stage in its canonical spelling, its words joined by single spaces, with `sort`
  always naming its direction and `top` writing `n` without leading zeros:
  `["source logs", "where status >= 500", "sort ts asc", "top 7"]`.

A query fails, in both calls, when a part is empty, the source isn't `logs`, a stage doesn't
match a row of the table exactly (case matters), or a field name is bad. A field name is
letters, digits, `_` and `.`, and not empty. Values are printable ASCII, and a `where`
value is a single word. There are at most 10^4 calls.
