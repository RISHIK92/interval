> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If `lint` held an `if` for every rule name, which code would you have to reopen to add a fourth rule?

## Approach

Give every rule the same small shape: built from its parameter (refusing one it doesn't accept) and able to say whether one line breaks it. Keep a table from rule name to how to build that rule. `enable` looks the name up in the table and stores the built rule under its name, replacing any earlier one. `lint` walks the lines in order and, for each, asks the enabled rules in name order. Nothing in `Linter` mentions a particular rule, so a new rule is a new class and one more table entry.

## Code sketch

```text
interface Rule
  flags(line) -> bool

class MaxLineLength implements Rule     // constructor checks param >= 1
class NoTabs implements Rule            // constructor checks param == 0
class NoTrailingSpaces implements Rule  // constructor checks param == 0

RULES = { "max-line-length": MaxLineLength, ... }

class Linter
  rules  // name -> Rule

  enable(rule, param)
    // TODO: fail on an unknown name; build it (it checks param); store it
  lint(lines) -> list
    // TODO: for each line, for each rule in name order:
    // TODO:   "<number>:<name>" when it flags the line
  enabled() -> list
    // TODO: the names, sorted
```
