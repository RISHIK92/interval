# Log redaction

> PROVISIONAL (LLD practice batch C2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build a redactor that removes secrets from log lines before they're written. Each kind of
secret is a rule, enabled one by one. A line is split into words at every single space
(two spaces in a row leave an empty word between them, and empty words never match), the
enabled rules run over the words in the order they were enabled, each seeing what the
rules before it left, and the words are joined back with single spaces, so the line's
spacing is kept exactly.

| Rule       | A word it matches                                                                                                                        | Becomes                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `"email"`  | has exactly one `@`, at least one character before it, and a `.` after it that is neither the first nor the last character after the `@` | `"[email]"`                                             |
| `"card"`   | 13 to 19 characters, all digits `0`–`9`                                                                                                  | a `*` for each digit but the last four, then those four |
| `"bearer"` | any non-empty word right after a word that is exactly `"Bearer"`                                                                         | `"[token]"`                                             |

The bearer rule goes left to right, so in `"Bearer Bearer x"` the second `Bearer` becomes
`"[token]"` and `x` stays. Punctuation is part of a word: `"x@y.z,"` is an email and
`"#4111111111111111"` isn't a card.

- `Redactor()`: starts with every rule disabled and no hits.
- `enable(rule)`: the rule runs after the rules already enabled. Enabling an enabled rule
  changes nothing, so it keeps its place. A rule disabled and enabled again goes last.
- `disable(rule)`: the rule stops running. Disabling a disabled rule changes nothing.
- `redact(line)`: the line with every enabled rule applied. A line may be empty.
- `hits(rule)`: how many words the rule has matched in all, counted each time it matches
  one, even a word an earlier rule already changed and even one that already reads like
  its replacement (`"Bearer [token]"` is one bearer hit). Disabling a rule keeps its count.

An unknown rule (case matters), including an empty one, fails in `enable`, `disable` and
`hits`. A call that fails changes nothing. Lines are printable ASCII, at most 1000
characters, and there are at most 10^4 calls.

For example, with `"email"` and then `"card"` enabled,
`redact("user bob@example.com paid with 4111111111111111")` is
`"user [email] paid with ************1111"`.
