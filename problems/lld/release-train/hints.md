> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

When a team pulls a change, who should be responsible for telling QA and security that their sign-offs no longer count?

## Approach

Make the release train the one coordinator that every request goes through, and keep each train a simple object that knows only its own changes in boarding order, the roles that have signed it and whether it has departed. The train's own add and remove operations clear its sign-offs, so no caller can change a train's contents without voiding them. The coordinator keeps the list of trains in creation order and a map from each aboard change to its train, plus the set of changes that have departed. Boarding scans the trains for the first one still open, creating one when none is; signing off, pulling and departing look the train or change up and apply the statement's checks in turn.

## Code sketch

```text
class Train
  name, changes: ordered map change -> team
  signed: set of roles, departed = false
  ready() -> bool           // TODO: both roles signed
  take(change, team)        // TODO: add, clear signed
  drop(change) -> team      // TODO: remove, clear signed

class ReleaseTrain
  trains: list of Train
  aboard: map change -> Train
  departed: set of changes

  board(team, change) -> name
    // TODO: validate; first open train, or a new "T<n>"
  signOff(role, train) -> bool      // TODO
  pull(change) -> bool              // TODO
  depart(train) -> list             // TODO: "<team>:<change>" in order
```
