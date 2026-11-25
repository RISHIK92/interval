> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

What part of an event is the same for every event with that pattern, and what part belongs to that one event alone?

## Approach

Make the pattern a small immutable object, split once at its placeholders into literal parts, and keep exactly one per pattern text in a map. An event is just a reference to that shared object plus its own list of parameters, stored under its id. Rendering interleaves the shared parts with the event's parameters, so a parameter is never searched for placeholders. Validate the parameter count against the parts before storing anything, so a failed call interns nothing and uses no id. Keep a second map from pattern text to the ids that use it, appended in order.

## Code sketch

```text
class Template                      // shared, never changes
  parts: list of literal strings    // pattern split at "{}"
  holes() -> int                    // TODO: parts - 1
  render(params) -> string          // TODO: interleave

class LogStore
  templates: map pattern -> Template
  events: map id -> (Template, params)
  ids: map pattern -> list of ids
  last = 0

  log(pattern, params) -> int
    // TODO: fail on empties
    // TODO: find or make the Template; check holes
    // TODO: only now store, assign the next id
  render(eventId) -> string         // TODO
  templates() -> int                // TODO
  byPattern(pattern) -> list        // TODO
```
