# Feature flag: allowlist (extension round)

> PROVISIONAL (LLD practice batch A1, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Some users (the team, say) should see the feature before the rollout reaches them.

- `allow(userBucket)`: puts the bucket on the allowlist. An allowlisted bucket is on
  whenever the flag isn't killed, whatever the rollout percentage. Allowing a bucket twice
  changes nothing. A bucket outside 0–99 fails and changes nothing.
- The kill switch still wins: a killed flag is off for allowlisted buckets too.
