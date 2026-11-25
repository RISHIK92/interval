> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

When a team is disbanded, which of the things you store belong to the team, and which belong to the engineers who were on it?

## Approach

Keep engineers and teams in two separate maps, so neither owns the other. A membership is a link stored on both sides: the team keeps its members' names in join order, and each engineer keeps the set of their teams. `join` adds the link to both sides; `disband` removes the team and walks its member list to drop that one link from each engineer, leaving the engineers themselves untouched. `teamsOf` sorts the engineer's set when asked.

## Code sketch

```text
class OncallRoster
  teamsByName: map engineer -> set of team
  members: map team -> list of engineer   // join order

  addEngineer(name)
    // TODO: fail on empty or known name; teamsByName[name] = {}
  addTeam(team)
    // TODO: fail on empty or existing team; members[team] = []
  join(team, name) -> bool
    // TODO: fail unless both exist
    // TODO: false when team is already in teamsByName[name]
    // TODO: link both sides
  disband(team) -> bool
    // TODO: false when the team doesn't exist
    // TODO: drop the team from each member's set
    // TODO: remove the team, never the engineers
  teamsOf(name) -> list
    // TODO: fail when unknown; the set, sorted
```
