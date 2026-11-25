# Environment templates: what changed (extension round)

> PROVISIONAL (LLD practice batch 6a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Reviewers want to see how a preview differs from what it was forked from.

- `diff(env)`: one line per variable whose value differs from the variables the
  environment was forked with:
  - `+<key>=<value>` for a key the environment didn't have when it was forked;
  - `~<key>=<value>` for a key it had with a different value (the line shows the new
    value).

  The lines are sorted by key in ascending order by character code (`"Z"` before `"a"`).
  A variable set back to its forked value is no longer a change.

- The comparison is with the template as it was at the fork: redefining the template
  later changes no environment's diff.
- An environment the platform doesn't have, or an empty name, fails.
