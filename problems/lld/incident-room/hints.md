> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If only the incident may write to its timeline, which object should hold the timeline, and what should the room ask it to do instead of appending lines itself?

## Approach

Give each incident its own object that holds the commander, the set of responders, the last time written and the list of lines, with one method that formats and appends a line. The room only looks incidents up and checks arguments: one helper finds the incident and rejects a `nowMs` earlier than its last line, so every call shares the same failure rules. Each operation then checks its refusal (responder or not, commander already) before asking the incident to write; a handoff writes its line before the commander changes, so it still names who handed off.

## Code sketch

```text
class Incident
  commander; responders: set; lastMs; lines: list
  write(nowMs, text)
    // TODO: lastMs = nowMs; append "<nowMs> <text>"

class IncidentRoom
  incidents: map id -> Incident

  at(id, nowMs) -> Incident
    // TODO: fail on empty id, bad or backward nowMs, unknown id
  declareIncident(id, commander, nowMs)
    // TODO: fail if id exists; new Incident writes "declared by"
  joinIncident(id, responder, nowMs) -> bool
    // TODO: false if already a responder; add, write "joined"
  note(id, author, text, nowMs) -> bool
    // TODO: false unless author is a responder; write
  handOff(id, to, nowMs) -> bool
    // TODO: false unless to is a responder and not commander
    // TODO: write the handoff line, then change commander
  timeline(id) -> list
```
