# Feature flag

> PROVISIONAL (LLD practice batch A1, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build one feature flag that rolls a feature out to a percentage of users. Every user has a
bucket, an integer from 0 to 99; the flag is on for a user when their bucket is below the
rollout percentage. A kill switch turns the flag off for everyone, whatever the
percentage.

- `FeatureFlag(name, rolloutPercent)`: `name` is not empty and `rolloutPercent` is from 0
  to 100, or the constructor fails. The flag starts live (not killed).
- `enabledFor(userBucket)`: true when the flag isn't killed and `userBucket` is below the
  rollout percentage, so 0% is off for everyone and 100% is on for everyone. A bucket
  outside 0–99 fails, killed or not.
- `setRollout(percent)`: sets the rollout percentage. A percentage outside 0–100 fails and
  changes nothing. It can be set while the flag is killed and applies once it's revived.
- `kill()`: turns the flag off for every bucket until `revive()`. Killing a killed flag
  changes nothing.
- `revive()`: lifts the kill switch; the flag uses the latest rollout percentage. Reviving
  a live flag changes nothing.
