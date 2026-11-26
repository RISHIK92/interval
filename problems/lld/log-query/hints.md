> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If parsing a query gave you a list of stage objects, which two calls could then share that list?

## Approach

Parse once, run or explain many: a query becomes a pipeline, a source plus a list of stage objects, one class per stage kind, each knowing how to turn rows into rows. Running is the interpreter: start from the source's rows and feed them through each stage. Explaining is a visitor over the same stage objects, one method per kind that writes the canonical line, so adding a new kind of output never touches the stages. Put the value order in one function used by both filtering and sorting, so the two can never disagree, and use your language's stable sort with that comparator.

## Code sketch

```text
compare(a, b) -> int              // TODO: integers by value first, then char codes

interface Stage
  apply(rows) -> rows
  accept(visitor) -> string

class Where(field, op, value)     // TODO: keep rows with field where op(compare(...))
class Count(field)                // TODO: first-appearance order, field + count
class Sort(field, descending)     // TODO: stable sort, rows without field last
class Top(n)                      // TODO: first n rows

class Explainer                   // visitor: where/count/sort/top -> canonical line

parse(query) -> (source, stages)  // TODO: split on |, then spaces; fail on bad parts

class LogQuery
  records: list of map
  ingest(fields)                  // TODO: validate, append
  run(query) -> list of string    // TODO: feed records through stages, format rows
  explainQuery(query) -> list     // TODO: "source logs" + each stage.accept(Explainer)
```
