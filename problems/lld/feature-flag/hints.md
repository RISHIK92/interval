> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

Which one fact about the flag decides the answer before the percentage is even looked at?

## Approach

Keep the state private: the rollout percentage, a killed flag, and nothing a caller can set directly. Every way a percentage or a bucket gets in (the constructor, `setRollout`, `enabledFor`) goes through one range check for its kind, so the percentage can never leave 0–100. `enabledFor` validates the bucket first, then answers false when killed, else compares the bucket with the percentage. `kill` and `revive` only flip the switch, so the percentage survives them.

## Code sketch

```text
class FeatureFlag
  name
  percent
  killed

  constructor(name, rolloutPercent)
    // TODO: fail on an empty name or a percent outside 0-100
  checkedPercent(percent) -> int
    // TODO: the one range check for 0-100
  enabledFor(userBucket) -> bool
    // TODO: fail on a bucket outside 0-99
    // TODO: false when killed, else bucket < percent
  setRollout(percent)
    // TODO: validate, then store
  kill()
    // TODO: switch off
  revive()
    // TODO: switch back on; the percent is unchanged
```
