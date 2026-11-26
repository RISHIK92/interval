# Alert expressions: renaming a metric (extension round)

> PROVISIONAL (LLD practice batch 8c, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Metrics get renamed when exporters are upgraded, and nobody wants to retype every alert.
The parsed expression is rewritten in place, and printed back so the change can be
reviewed.

- `rewrite(name, replacement)`: every comparison on metric `name` now compares
  `replacement` instead, and the call returns the whole expression printed in canonical
  form. `name` must be one of `variables()`, and `replacement` must be a valid metric
  name (not a keyword), or it fails. Renaming to a name already in use merges the two,
  and renaming a metric to itself changes nothing.
  - From then on, `evaluate`, `variables` and later rewrites see the new name. `depth`
    and `evaluations` don't change.
  - Canonical form: a comparison prints as `<name> <operator> <integer>` with single
    spaces, the integer in plain decimal (no leading zeros, and `0` for `-0`);
    `not x` prints as `not ` followed by `x`; and `x and y` and `x or y` print as
    `(<x> and <y>)` and `(<x> or <y>)`, with brackets even at the top level.

For example, `"a>1 or a<=-0 or (b != 007)"` with `a` renamed to `A` prints as
`"((A > 1 or A <= 0) or b != 7)"`.
