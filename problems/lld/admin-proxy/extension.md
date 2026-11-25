# Protected admin API: break-glass access (extension round)

> PROVISIONAL (LLD practice batch 7b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

During an incident the on-call engineer may need an action their roles don't allow. Rather
than granting a role and forgetting to take it back, they break the glass: they get every
action until they end it, and every call they make meanwhile is marked in the audit for
the review afterwards.

- `breakGlass(user)`: from now on, every action is allowed to `user`, as if they held
  `"admin"`, and the call returns true. A user already in break-glass is refused: false.
- `endBreakGlass(user)`: ends it and returns true; the user's own roles apply again. A user
  not in break-glass is refused: false.
- Both fail for a user who has never been granted a role (including an empty user):
  break-glass is for people the proxy already knows.
- While `user` is in break-glass, the audit line of each of their invokes ends with
  `" break-glass"`, as in `"oncall delete cache 200 break-glass"`, even for an action their
  own roles allow. Other users' lines are unchanged.
