# Log redaction: custom rules (extension round)

> PROVISIONAL (LLD practice batch C2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Teams keep finding new secrets in their logs and want to add rules of their own without
waiting for a release.

- `maskAfter(name, prefix)`: adds a rule called `name` that works like `"bearer"` with
  `prefix` in place of `"Bearer"`: every non-empty word right after a word that is exactly
  `prefix` becomes `"[" + name + "]"`, left to right. A name that is empty or already a
  rule (`"email"`, `"card"`, `"bearer"` or a custom one) fails, and so does a `prefix` that is
  empty or has a space in it.
- A new rule starts disabled with no hits. `enable`, `disable` and `hits` take it like any
  other rule, and it runs in its place in the enabled order.

For example, after `maskAfter("password", "password:")` and `enable("password")`,
`redact("login password: hunter2")` is `"login password: [password]"`.
