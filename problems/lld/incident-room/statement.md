# Incident room

> PROVISIONAL (LLD practice batch A3, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build the incident room an on-call team works in. Each incident owns its timeline: the
timeline is created with the incident and only the incident writes to it. Responders are
people associated with an incident, and one of them is its commander.

Timeline lines are written in this exact form, where `<t>` is the call's `nowMs` in
decimal:

| When                      | Line                            |
| ------------------------- | ------------------------------- |
| an incident is declared   | `<t> declared by <commander>`   |
| a responder joins         | `<t> <responder> joined`        |
| a responder writes a note | `<t> <author>: <text>`          |
| the commander hands off   | `<t> <from> handed off to <to>` |

- `IncidentRoom()`: starts with no incidents.
- `declareIncident(id, commander, nowMs)`: opens an incident whose only responder is
  `commander`, who commands it, and writes the declaration to its timeline. An id already
  declared fails.
- `joinIncident(id, responder, nowMs)`: `responder` joins the incident, the join is
  written to the timeline, and the call returns true. It returns false and changes nothing
  when they're already a responder.
- `note(id, author, text, nowMs)`: writes the note to the timeline and returns true. Only
  responders write notes: it returns false and changes nothing when `author` isn't one.
- `handOff(id, to, nowMs)`: `to` becomes the commander, the handoff, from the current
  commander to `to`, is written to the timeline, and the call returns true. The commander must be
  a responder, so it returns false and changes nothing when `to` isn't one, or is already
  the commander.
- `timeline(id)`: the incident's timeline lines, oldest first.

Time never goes backwards within an incident: a call whose `nowMs` is earlier than the
incident's last timeline line fails (an equal time is fine), and so does a `nowMs` outside 0 to 10^15.
An unknown incident fails in every call but `declareIncident`, and so does an empty id,
name or text. A call that fails changes nothing, and failing comes first: a call that
breaks one of these rules fails even when it would otherwise have returned false. Names
and notes are printable ASCII, names are case-sensitive, and there are at most 10^4 calls.
