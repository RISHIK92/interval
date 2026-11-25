# Semantic version: ranges (extension round)

> PROVISIONAL (LLD practice batch A1, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Dependency files pin ranges, not single versions.

- `satisfies(constraint)`: whether this version falls in the range. A constraint is `^`
  or `~` followed directly by a version's text (the same rules as the constructor's);
  anything else fails, including an empty constraint or a space before the operator.
  - `^base`: at least `base` and compatible with it, as `isCompatible` says: `^1.2.0`
    takes `1.2.0` up to, not including, `2.0.0`, and `^0.3.1` takes `0.3.1` up to, not
    including, `0.4.0`. Unlike npm, `^0.0.3` also takes `0.0.4`: under major 0 only the
    minor part must match.
  - `~base`: at least `base` with the same major and minor parts: `~1.4.0` takes `1.4.0`
    up to, not including, `1.5.0`, whatever the major part.
