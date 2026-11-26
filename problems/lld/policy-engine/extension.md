# Access policy engine: what-if (extension round)

> PROVISIONAL (LLD practice batch 8d, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Before adding a policy, an admin wants to see what it would change.

- `simulate(text, user, roles, action, resource, hour)`: the decision `decide` would give
  if a policy with `text` had been added after all the current ones. In the result, that
  policy's id is written `(new)`: `"deny:(new)"`. Nothing is added or changed.
- Bad text fails, and the request's arguments fail as in `decide`.
