# Dashboards and saved queries: duplicating (extension round)

> PROVISIONAL (LLD practice batch A3, Q-WD-30): drafted by Claude; the owner reviews it before launch.

- `duplicate(dashboard, newName)`: creates the dashboard `newName` with a copy of every
  panel of `dashboard`, under the same panel names, and returns true. The copies are the
  new dashboard's own panels, but they point to the same saved queries: queries are
  shared, never copied.
- It returns false and changes nothing when a dashboard named `newName` already exists
  (`dashboard` itself included). An unknown `dashboard`, or an empty name, fails.
- The two dashboards are independent afterwards: adding a panel to one, or dropping one,
  leaves the other as it was.
