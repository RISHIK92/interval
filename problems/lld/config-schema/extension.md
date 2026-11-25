# Service config schema: fallbacks (extension round)

> PROVISIONAL (LLD practice batch A2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Optional settings get defaults, so a config can leave them out.

- `fallback(field, value)`: when a config checked from now on doesn't have `field`, its
  value is taken to be `value`. Setting it again replaces it. A value in the config always
  wins over the fallback.
- The fallback is checked like any given value: `int` and `oneOf` rules report it if it
  breaks them (a fallback of `x` on an `int:1:8` field reads `W: not an integer`).
- Only an optional field takes a fallback: `fallback` fails, changing nothing, for a field
  with no rules or with a `required` rule. Once a field has a fallback,
  `rule(field, "required")` fails and changes nothing; its other rules are still added.
- A fallback doesn't add a field to `fields()`.
