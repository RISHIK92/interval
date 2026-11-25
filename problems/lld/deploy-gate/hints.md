> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If every caller read each check's last result and decided for itself, how many places would change when the rule for what blocks a deploy changes?

## Approach

Keep the state inside the gate: the set of required checks and each check's latest result in a map (filled whether or not the check is required). Put the rule for "does this check block?" in one private method: its latest result isn't a pass, with no result counting as not passed. `mayDeploy` asks whether any required check blocks, and `blockers` lists the ones that do, sorted. Callers only ever tell the gate things or ask it the one question.

## Code sketch

```text
class DeployGate
  required: set of check
  latest: map check -> bool

  require(check)
    // TODO: fail on an empty name; add to required
  report(check, passed)
    // TODO: fail on an empty name; latest[check] = passed
  blocks(check) -> bool
    // TODO: true unless latest[check] is a pass
  mayDeploy() -> bool
    // TODO: no required check blocks
  blockers() -> list
    // TODO: required checks that block, sorted by character code
```
