# Org chart: promotions (extension round)

> PROVISIONAL (LLD practice batch A3, Q-WD-30): drafted by Claude; the owner reviews it before launch.

- `promote(name)`: `name` swaps places with their manager, and the call returns true.
  Afterwards `name` reports to whoever their manager reported to, and the former manager
  reports to `name`. The former manager's other reports now report to `name`, and
  `name`'s former reports now report to the former manager.
- If the manager was the root, `name` becomes the root, and the former root reports to
  them like anyone else (they can now leave or be reassigned).
- `promote` returns false and changes nothing when `name` isn't in the chart or is the
  root. An empty name fails.

For example, with `ceo` over `vp`, `vp` over `ann` and `bob`, and `ann` over `cat`,
`promote("ann")` leaves `ceo` over `ann`, `ann` over `vp` and `bob`, and `vp` over `cat`.
