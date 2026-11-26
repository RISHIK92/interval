> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

When nobody acknowledges in time, how does a level know who to hand the page to, without the incident knowing the whole rota?

## Approach

Build the rota as a chain of level objects, each holding its person and a link to the next level (none for the last). An incident remembers the level it's at, the person who was actually paged there, and when. A tick walks the open incidents in name order and asks each one's level to pass it on when its time is up and there is a next link; the incident then points at that link and restarts its timer. Acknowledging is only accepted from the person the incident currently names. Keep one "latest time seen" and check it before changing anything, so a call with an earlier time fails cleanly.

## Code sketch

```text
class Level
  person
  next: Level or none

class Incident
  level, holder, pagedAt, acked

class Escalation
  first: Level              // built from the list, last to first
  incidents: map name -> Incident
  now = 0

  page(incident, nowMs) -> string
    // TODO: fail on empty/known incident or earlier time
    // TODO: holder = first.person; remember pagedAt
  tick(nowMs) -> list
    // TODO: for each incident by name: unacked, has next, timed out?
    // TODO: move it, restart its timer, report it
  ack(incident, person, nowMs) -> bool
    // TODO: only the current holder, only once
  holder(incident) -> string or none   // TODO
```
