# CI job spec: secrets (extension round)

> PROVISIONAL (LLD practice batch A1, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Jobs need tokens, and a rendered job ends up in logs, so a secret's value must never be
shown.

- `secret(key, value)`: sets a variable whose value is secret. The key follows `setEnv`'s
  rule, or the call fails and changes nothing. The value can be any string, the empty one
  included.
- `render()` writes a secret variable as `env <key>=***`, in its sorted place among the
  others.
- Secrets and plain variables share keys: whichever of `setEnv` and `secret` set a key
  last decides its value and whether it's shown. `secret` on a plain variable hides it, and
  `setEnv` on a secret makes it plain again.
