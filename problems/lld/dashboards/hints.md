> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

Which things should a dashboard hold inside itself, and which should it only refer to by name, given what has to survive when the dashboard is dropped?

## Approach

Keep the saved queries in one map of their own (name to expression), outside every dashboard. Each dashboard holds its panels inside itself, panel name to query name, so dropping the dashboard drops exactly its panels and nothing else. A panel's link to its query is just the query's name, which makes "is this query in use?" a scan of every dashboard's panels; the same scan, formatted and sorted, answers `usage`, and `dropQuery` refuses while it finds anything.

## Code sketch

```text
class Dashboards
  queries: map name -> expr
  dashboards: map dashboard -> map panel -> query name

  saveQuery(name, expr)
    // TODO: fail on empty strings or a saved name
  addPanel(dashboard, panel, query) -> bool
    // TODO: false if query isn't saved
    // TODO: false if the dashboard already has this panel
    // TODO: create the dashboard if needed; store panel -> query
  dropDashboard(dashboard) -> int
    // TODO: fail if unknown; remove it; return its panel count
  dropQuery(name) -> bool
    // TODO: false if unknown or usage(name) is not empty
  usage(query) -> list
    // TODO: fail if not saved
    // TODO: every "<dashboard>/<panel>" pointing at it, sorted
```
