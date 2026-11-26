# Log query language: saved views (extension round)

> PROVISIONAL (LLD practice batch 8d, Q-WD-30): drafted by Claude; the owner reviews it before launch.

People keep retyping the same first few stages. Let them save a query as a view and start
later queries from it.

- `saveView(name, query)`: saves `query` as the view `name`. A bad name (same rules as a
  field name), a query that fails, or a name that's `logs` or already a view fails.
- A query's source may now be a view's name. Its rows are the view's query run at that
  moment, over the records ingested so far, and the stages that follow take those rows. A
  view's query may itself start from an earlier view.
- `explainQuery` lists a view source as the view's own explanation, then the stages that
  follow: with `saveView("errors", "logs | where level = error")`,
  `explainQuery("errors | top 2")` returns
  `["source logs", "where level = error", "top 2"]`.
