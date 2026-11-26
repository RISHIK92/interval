# Release train

> PROVISIONAL (LLD practice batch 8c, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Teams don't ship on their own schedule: their changes board release trains, QA and
security sign each train off, and a train departs only when both have. Nobody talks to
anybody else directly. The train coordinates, so a team pulling its change out of a
train means QA and security have to sign it off again.

Trains are named `"T1"`, `"T2"`, and so on, in the order they're created; there are none
at first.

- `ReleaseTrain()`: no trains and no changes.
- `board(team, change)`: puts the change on the boarding train and returns its name. The
  boarding train is the lowest-numbered train that hasn't departed and isn't fully
  signed off. If there is none, a new train is created for it. So a change that arrives
  after a train is fully signed off is late and waits for the next train.
  A change that is aboard a train, or has departed, fails. A pulled change may board
  again.
- `signOff(role, train)`: `role` is `"qa"` or `"security"`, and anything else fails, as
  does a train that doesn't exist. Returns `false` if the train has departed, has no
  changes aboard, or already has this role's sign-off; otherwise records it and returns
  `true`. A train with both sign-offs is fully signed off.
- `pull(change)`: takes the change off its train and returns `true`, or returns `false`
  if it isn't aboard a train (never boarded, pulled already, or departed).
- `depart(train)`: if the train is fully signed off and hasn't departed, it departs:
  returns its changes as `"<team>:<change>"`, in the order they boarded. Otherwise it
  returns an empty list and nothing changes. A train that doesn't exist fails.

Whenever a change boards a train or is pulled from it, the train loses both its
sign-offs. Trains depart independently: a later train may depart before an earlier one.

Teams and changes are printable ASCII and case-sensitive, and an empty one fails. A call
that fails changes nothing, and a call that would both fail and return `false` fails.
There are at most 10^4 calls.

For example, after `board("web", "c1")` returns `"T1"` and both roles sign `T1` off,
`board("api", "c2")` returns `"T2"`. If `c1` is then pulled, `T1` is no longer signed off
and the next change boards it again.
