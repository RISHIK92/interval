# On-call escalation

> PROVISIONAL (LLD practice batch 8b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

An incident page goes to the primary on-call first. If they don't acknowledge it in time,
it passes to the next level of the rota, and so on down the list. Build the escalation
chain. The clock is driven from outside: pages only move when `tick` is called.

- `Escalation(levels, ackTimeoutMs)`: the rota, primary first. It fails when the list is
  empty, a name is empty, a name appears twice, or `ackTimeoutMs` is below 1.
- `page(incident, nowMs)`: opens the incident, pages the first level and returns who was
  paged. Paging an incident that was paged before, acknowledged or not, fails.
- `tick(nowMs)`: moves every incident that is still unacknowledged and whose holder was
  paged at least `ackTimeoutMs` ago (`nowMs - pagedAt >= ackTimeoutMs`) on to the next
  level, at most one level per incident per tick. The new holder counts as paged at this
  tick's `nowMs`. Returns one `"<incident> -> <person>"` per incident moved, sorted by
  incident name. An incident at the last level stays there and is never listed again.
- `ack(incident, person, nowMs)`: the incident's current holder acknowledges it: it
  returns true, and the incident never moves again. Returns false, leaving the incident as it was, when
  the incident was never paged, is already acknowledged, or `person` isn't its current
  holder. A holder whose time is up can still acknowledge until a tick moves the page on.
- `holder(incident)`: who holds the incident now (after an acknowledgement, the person
  who acknowledged), or null when it was never paged.

Every `nowMs` is at least 0 and at least the `nowMs` of every earlier call that didn't
fail, including calls that returned false; a call that breaks this fails. An empty incident or person fails, in every call.
Failing comes before returning false, and a call that fails changes nothing. Names are
printable ASCII and case-sensitive, and "sorted" means by character code. There are at
most 10 levels, `ackTimeoutMs` and `nowMs` are at most 10^12, and there are at most 10^4
calls.

For example, with levels `["ana", "bo", "cy"]` and a timeout of 300,
`page("db-down", 1000)` returns `"ana"`, `tick(1299)` returns `[]` and `tick(1300)`
returns `["db-down -> bo"]`. Then `ack("db-down", "ana", 1350)` returns false and
`ack("db-down", "bo", 1400)` returns true.
