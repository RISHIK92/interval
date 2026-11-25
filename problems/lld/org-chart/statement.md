# Org chart

> PROVISIONAL (LLD practice batch A3, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build a company's org chart. Every person but one reports to exactly one manager, and the
one who doesn't is the root, at the top. Following managers upwards from anyone always
reaches the root: there are never cycles. A manager groups their reports, but doesn't own
them: when someone leaves, their reports stay, and move up to that person's manager.

- `OrgChart(ceo)`: a chart holding only `ceo`, who is the root.
- `hire(name, manager)`: adds `name`, reporting to `manager`, and returns true. It returns
  false and changes nothing when `name` is already in the chart or `manager` isn't.
- `reassign(name, manager)`: `name` now reports to `manager`, and the call returns true;
  `name`'s own reports come along, still reporting to `name`. It returns false and changes
  nothing when either person isn't in the chart, when `name` is the root, or when the move
  would make a cycle: `manager` is `name`, or reports to `name` directly or not.
  Reassigning someone to the manager they already have returns true and changes nothing.
- `leave(name)`: removes `name` from the chart, and each of their direct reports now
  reports to `name`'s manager. Returns true, or false (changing nothing) when `name` isn't
  in the chart or is the root. Someone who left can be hired again.
- `chain(name)`: `name`, then their manager, then that manager's manager, and so on up
  to the root, which is last. An unknown person fails.
- `span(manager)`: how many people report directly to `manager`. An unknown person fails.

An empty name fails in every call, the constructor included, and a call that fails changes
nothing. Names are printable ASCII and case-sensitive. There are at most 10^4 calls.
