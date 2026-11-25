> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If the header syntax, the list of sections and the line format all lived in one `release` method, how much of it would you reread to change just one of them?

## Approach

Split the work into three functions that know nothing of each other. A parser turns one message into an entry (type, scope, breaking flag, description, sha) or nothing; a regular expression for the header does it in one line. A grouper takes the entries and returns the non-empty sections in their fixed order, each entry under the section its type maps to. A renderer turns a version and those sections into lines. The class keeps only the unreleased entries, the shas it has seen and the versions it has released, checks the failures, and passes entries from one function to the next.

## Code sketch

```text
parse(sha, message) -> entry or null
  // TODO: match type, optional (scope), optional !, ": ", description

group(entries) -> list of (title, entries)
  // TODO: Features, Fixes, Other; drop empty sections

render(version, sections) -> list of lines
  // TODO: "## version", "### title", "- [scope: ]description (sha7)"

class Changelog
  pending, shas, versions

  commit(sha, message) -> bool
    // TODO: fail on empty; false if unparsed or sha seen; keep it
  release(version) -> list
    // TODO: fail on empty, released version, nothing pending
    // TODO: render(version, group(pending)); remember; clear
  unreleased() -> int
```
