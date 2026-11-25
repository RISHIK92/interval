# API keys with scopes: rotation (extension round)

> PROVISIONAL (LLD practice batch A2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Keys are rotated without downtime: the old key keeps working for a short grace period
while clients move to the new one.

- `rotate(keyId, nowMs)`: issues a new key (the next `key-N` name) with the old key's
  owner, its current grant and its time to live, starting at `nowMs`, and returns its
  name. The old key now expires at `nowMs + 60000`, or at its own expiry if that's
  sooner; until then it works as before.
- It fails, changing nothing, when the key is unknown, revoked, already rotated, or
  doesn't work at `nowMs` (it has expired), or `nowMs` is outside 0 to 10^13.
- Both keys are ordinary keys afterwards: either can be narrowed or revoked on its own,
  and the new one can be rotated in turn.
