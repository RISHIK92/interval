# Webhook event router: exclusions (extension round)

> PROVISIONAL (LLD practice batch D2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

The audit handler takes every event, except it shouldn't see CI noise. That needs a
negative matcher.

- `exclude(handler, pattern)`: from now on, `deliver` leaves the handler out for any event
  the pattern matches, whatever its routes match. Patterns are the same three kinds, with
  the same rules, and a pattern that isn't one of them fails. A handler can have any number
  of exclusions; adding one it already has changes nothing. A handler with no routes can
  still be given exclusions, which apply once it has routes.
- `unroute(handler)` now removes the handler's exclusions too. It still returns the number
  of routes removed.

For example, with the routes `("*", "audit")` and `("issue.*", "triage")` and the
exclusion `("audit", "ci.*")`, `deliver("ci.started")` is `[]` and `deliver("issue.x")` is
`["audit", "triage"]`.
