> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If `component` decided what to make by checking both the family and the kind, how many places would you touch to add a fourth environment?

## Approach

Make the family the unit of choice: one interface with a method per kind of component, and one implementation per family that knows only its own names. The kit holds the family in use, maps each kind to the matching method of that interface, and never names a concrete family when it makes something. Every component it makes is remembered by its ID together with the family that made it, so later questions about it (which family, can these two be wired) are answered from that record, not from whichever family is in use now.

## Code sketch

```text
interface Family
  name
  queue() -> string
  store() -> string
  clock() -> string
class Local / Ci / Staging implements Family

class EnvKit
  families: map name -> Family
  current: Family or none
  made: map componentId -> family name

  use(family)
    // TODO: fail on an unknown family
  component(kind) -> string
    // TODO: fail on an unknown kind, or no family in use
    // TODO: ask current for the name, add "#<count + 1>"
  wire(a, b) -> bool
    // TODO: fail on itself or an unknown id
  family(componentId) -> string
```
