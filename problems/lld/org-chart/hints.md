> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

Before moving someone under a new manager, what walk through the chart tells you the move would make a loop?

## Approach

Store the relationship from both ends: each person's manager (nothing for the root), and each manager's set of direct reports, and change both in one pair of small helpers (link and unlink) so they can't drift apart. `chain` walks managers up to the root. A reassignment makes a cycle exactly when the person appears in the new manager's chain, so check that before linking. `leave` unlinks the person and relinks each of their reports to the person's own manager.

## Code sketch

```text
class OrgChart
  root
  manager: map person -> person or none
  reports: map person -> set of person

  link(name, boss) / unlink(name)
    // TODO: change manager[name] and reports[boss] together
  hire(name, boss) -> bool
    // TODO: false if name known or boss unknown; link
  reassign(name, boss) -> bool
    // TODO: false if either unknown or name is root
    // TODO: false if name is in chain(boss)
    // TODO: unlink(name); link(name, boss)
  leave(name) -> bool
    // TODO: false if unknown or root
    // TODO: link each of name's reports to manager[name]
    // TODO: forget name
  chain(name) -> list
    // TODO: follow manager up to the root
  span(boss) -> int
```
