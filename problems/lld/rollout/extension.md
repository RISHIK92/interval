# Deployment rollout: automatic promotion (extension round)

> PROVISIONAL (LLD practice batch 8b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

The rollout should promote or roll back on its own, driven by the error rate the canary
analysis measures.

- `autoAdvance(errorRate)`: `errorRate` is a percentage from 0 to 100; outside that it
  fails.
  - Under 1: does exactly what `advance()` would, and returns what it would return.
  - Over 5: does exactly what `abort()` would, and returns what it would return.
  - From 1 to 5, both included: holds, changing nothing, and returns false.
