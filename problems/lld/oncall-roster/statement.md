# On-call roster

> PROVISIONAL (LLD practice batch A3, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build the roster an on-call rota is drawn from. Engineers and teams exist on their own,
and an engineer can belong to any number of teams. A team aggregates its engineers but
doesn't own them: disbanding a team removes the team and its memberships, and every
engineer stays on the roster with their other teams.

- `OncallRoster()`: starts with no engineers and no teams.
- `addEngineer(name)`: adds an engineer who is on no team. A name already on the roster
  fails.
- `addTeam(team)`: adds a team with no members. A team that exists fails; the name of a
  disbanded team can be used again, for a new, empty team.
- `join(team, name)`: the engineer joins the team, and the call returns true. It returns
  false and changes nothing when the engineer is already on that team. An unknown team or
  engineer fails.
- `disband(team)`: removes the team and returns true. Its engineers stay on the roster.
  Returns false when no team has that name (it was never added, or is already disbanded).
- `teamsOf(name)`: the engineer's teams, sorted in ascending order by character code
  (`"B"` before `"a"`); an empty list when they're on none. An unknown engineer fails.

Engineer and team names are separate: an engineer and a team may share a name. An empty
name or team fails in every call, and a call that fails changes nothing. Names are
printable ASCII and case-sensitive. There are at most 10^4 calls.
