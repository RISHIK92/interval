# Semantic version

> PROVISIONAL (LLD practice batch A1, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build an immutable semantic version, `major.minor.patch`. Once made, a version never
changes: bumping one gives back the text of a new version.

A version's text is exactly three parts joined by `.`. Each part is 1 to 9 ASCII digits
with no leading zero (`0` itself is fine). Nothing else is allowed: no `v` prefix, no
spaces, no sign, no pre-release or build suffix. Every method that takes a version's text
fails on a malformed one.

- `SemVer(text)`: parses the version, or fails.
- `bump(part)`: the text of the next version, leaving this one unchanged. `"major"` adds 1
  to the major part and zeroes the other two, `"minor"` adds 1 to the minor part and
  zeroes the patch, and `"patch"` adds 1 to the patch. Any other `part` (case matters)
  fails. A bumped part may grow to 10 digits.
- `compareTo(other)`: -1 if this version is lower than `other`, 0 if they are equal and 1
  if it is higher, comparing major, then minor, then patch, as numbers (`1.10.0` is higher
  than `1.9.0`).
- `isCompatible(other)`: true when the two versions share a major part and it's 1 or more.
  Under major 0 anything may break, so two `0.x.y` versions are compatible only when they
  also share the minor part (`0.3.1` and `0.3.9` are; `0.3.1` and `0.4.0` aren't).
- `text()`: the version's text.
