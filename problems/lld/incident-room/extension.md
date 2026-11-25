# Incident room: resolution (extension round)

> PROVISIONAL (LLD practice batch A3, Q-WD-30): drafted by Claude; the owner reviews it before launch.

- `resolve(id, nowMs)`: resolves the incident, writes `<t> resolved` to its timeline, and
  returns true. Returns false and changes nothing when it's already resolved.
- After an incident is resolved, `note` returns false and writes nothing, even from a
  responder. Joins and handoffs work as before.
- `durationMs(id)`: how long the incident was open: the `nowMs` it was resolved at minus
  the `nowMs` it was declared at. An incident that isn't resolved yet fails.
- An unknown incident or an empty id fails, and so does a `nowMs` outside 0 to 10^15 or
  earlier than the incident's last timeline line. A call that fails changes nothing.
