# Lint rules

> PROVISIONAL (LLD practice batch 5a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build a small linter. It runs the rules you enable over a file's lines and reports what it
finds. More rules will come, and adding one shouldn't mean editing the ones that exist.

- `Linter()`: a linter with no rules enabled.
- `enable(rule, param)`: enables `rule` with its parameter. Enabling a rule that is already
  enabled replaces its parameter. An unknown rule (names are exact and case-sensitive),
  or a parameter the rule doesn't accept, fails.
- `lint(lines)`: the findings for these lines, each as `<line>:<rule>`, where `<line>`
  counts from 1. A line gets at most one finding per enabled rule. Findings are ordered by
  line number, then by rule name in ascending order by character code. With no rules
  enabled, or no lines, there are none.
- `enabled()`: the names of the enabled rules, in ascending order by character code.

The rules:

| Rule                 | Parameter        | A line is reported when                 |
| -------------------- | ---------------- | --------------------------------------- |
| `max-line-length`    | the maximum, ≥ 1 | it has more characters than the maximum |
| `no-tabs`            | must be 0        | it contains a tab                       |
| `no-trailing-spaces` | must be 0        | its last character is a space (`" "`)   |

A call that fails changes nothing. Lines are printable ASCII and tabs, at most 1000
characters each, with at most 1000 lines per call; parameters are between -10^9 and
10^9; and there are at most 10^4 calls.
