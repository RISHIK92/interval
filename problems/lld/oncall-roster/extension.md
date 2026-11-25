# On-call roster: rotation (extension round)

> PROVISIONAL (LLD practice batch A3, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Each team now takes turns being on call, in the order its engineers joined it.

- `rotate(team)`: hands the team's on-call to the next engineer and returns their name.
  The team's first rotation gives the engineer who joined it first. Each later one gives
  the engineer who joined right after the one last on call, and after the last to join it
  wraps round to the first.
- An engineer who joins later takes their place at the end of the join order, so they're
  reached when the rotation next passes the end.
- A team with no members, an unknown team or an empty team name fails and changes
  nothing. A team added again after being disbanded starts its rotation afresh.
