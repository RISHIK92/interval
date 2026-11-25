> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

What do a `required` rule, an `int` rule and a `oneOf` rule have in common, from the point of view of `check`?

## Approach

Give every rule kind one shared interface: given a field's value, or nothing when the field is absent, it returns its violation or nothing. One class per kind fills it in, and a single parser is the only place that reads spec text: it turns a spec into a rule object or fails before anything is stored. The schema keeps each field's rules in a list in the order they were added, and `check` walks the fields in sorted order, asking each rule about the field's value. It never asks which kind a rule is.

## Code sketch

```text
interface Rule
  violation(value or nothing) -> string or nothing

class Required, IntRange(low, high), OneOf(items) implement Rule
  // TODO: each answers only for its own kind

parse(spec) -> Rule
  // TODO: "required", "int:MIN:MAX" or "oneOf:A,B,..."; anything else fails

class ConfigSchema
  rules: map field -> list of Rule

  rule(field, spec)
    // TODO: parse first, fail on an empty field, then append
  check(env) -> list<string>
    // TODO: for each field in sorted order, value = env[field] or nothing
    // TODO: for each of its rules, add "FIELD: <violation>" when there is one
  fields() -> list<string>
    // TODO: the sorted keys of rules
```
