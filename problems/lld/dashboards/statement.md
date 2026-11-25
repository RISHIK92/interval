# Dashboards and saved queries

> PROVISIONAL (LLD practice batch A3, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build the dashboards of a metrics tool. Saved queries are shared: each has a name and an
expression, and exists on its own. A dashboard owns its panels: a panel is created on one
dashboard and goes when the dashboard is dropped. Each panel points to one saved query,
and many panels, on any dashboards, can point to the same query.

- `Dashboards()`: starts with no queries and no dashboards.
- `saveQuery(name, expr)`: saves a query. A name already saved fails.
- `addPanel(dashboard, panel, query)`: adds a panel named `panel` to the dashboard,
  pointing to the saved query `query`, and returns true. A dashboard is created by its
  first panel. It returns false and changes nothing when no query is saved under `query`,
  or when the dashboard already has a panel named `panel` (other dashboards may use the
  same panel name).
- `dropDashboard(dashboard)`: drops the dashboard and all its panels, and returns how
  many panels it had. The queries they pointed to stay saved. An unknown dashboard fails.
- `dropQuery(name)`: deletes the saved query and returns true. It returns false and
  changes nothing when no query has that name, or when any panel still points to it.
- `usage(query)`: the panels pointing to the query, each as `<dashboard>/<panel>`, sorted
  in ascending order by character code (`"B"` before `"a"`); an empty list when none do.
  A query that isn't saved fails.

Query and dashboard names are separate: a query and a dashboard may share a name. An
empty name, expression, dashboard or panel fails in every call, and a call that fails
changes nothing. Names are printable ASCII and case-sensitive, and there are at most 10^4 calls.
