# Service config schema

> PROVISIONAL (LLD practice batch A2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build a schema for a service's environment variables. Each field gets rules, written as
spec strings, and checking a config reports every rule it breaks.

| Spec          | The rule                                                             | Its violation           |
| ------------- | -------------------------------------------------------------------- | ----------------------- |
| `required`    | the field is in the config (an empty value counts as present)        | `FIELD: missing`        |
| `int:MIN:MAX` | the value is an integer: an optional `-` then 1 to 15 decimal digits | `FIELD: not an integer` |
|               | ...and it's from `MIN` to `MAX` inclusive                            | `FIELD: out of range`   |
| `oneOf:A,B,C` | the value is exactly one of the comma-separated items (case matters) | `FIELD: not allowed`    |

`FIELD` is the field's name, so a missing `PORT` reads `PORT: missing`. An `int` or
`oneOf` rule says nothing about a field that isn't in the config, and an `int` rule that
finds no integer doesn't also report its range. Leading zeros are fine (`007` is 7) and
`-0` is 0.

- `ConfigSchema()`: starts with no rules.
- `rule(field, spec)`: adds a rule to the field, after any rules it already has (adding
  the same rule twice means it's checked, and reported, twice). The spec must be one of
  the three forms above, spelled exactly:
  - `int:MIN:MAX` has exactly two bounds, each written like an integer value above, with
    `MIN` at most `MAX`;
  - `oneOf:` has at least one item and no empty item (`oneOf:a,,b` and `oneOf:a,` fail);
    an item may contain `:`.

  Any other spec (`Required`, `int:1`, `optional`), or an empty field name, fails and
  changes nothing.

- `check(env)`: every violation of the config `env` (a map from field to value), one
  string per broken rule. Fields come in ascending order by character code (`"B"` before
  `"a"`), and one field's violations in the order its rules were added. Fields in `env`
  without rules are ignored. Nothing broken gives an empty list.
- `fields()`: the fields that have at least one rule, in ascending order by character code.

Field names, specs and values are printable ASCII.
