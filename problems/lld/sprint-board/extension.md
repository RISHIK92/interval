# Sprint board: blocked tickets (extension round)

> PROVISIONAL (LLD practice batch A2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Work stalls on things outside the team, and the board should say so.

- `block(ticket, reason)`: marks the ticket blocked, with a reason. Blocking a blocked
  ticket replaces its reason. An unknown ticket or an empty reason fails and changes
  nothing.
- `unblock(ticket)`: the ticket is no longer blocked. A ticket that isn't blocked stays
  as it is. An unknown ticket fails.
- `blocked()`: one entry per blocked ticket, its id, `: ` and its reason
  (`"T-3: waiting on API"`), in the order the tickets were added (`T-2` before `T-10`).
- A blocked ticket stays in its column, and `move` returns false for it and changes
  nothing. While it is in `doing` it still counts toward the limit, and while it is in
  `done` its points still count toward `velocity`.

Reasons are printable ASCII.
