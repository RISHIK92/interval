# Feature flag SDK

> PROVISIONAL (LLD practice batch 7c, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Application code asks one question, "is this flag on for this user?", and the SDK hides
everything behind it: fetching rules from the flag server, keeping a local copy, and
evaluating targeting rules. The SDK must keep working when the server can't be reached:
with the built-in defaults before it has ever synced, and with its last copy afterwards.
The flag server is simulated inside the class.

- `FlagClient(defaults)`: the built-in defaults, flag to on/off. Nothing synced yet.
- `serverRules(flag, rules, version)`: publishes the flag's rules on the server, with a
  version. When the server already has this flag at the same or a newer version, the
  publish is ignored. A version below 1 fails, and so does any malformed rule, even in a
  publish that would be ignored: failing comes before ignoring. The client sees nothing
  of it until it syncs.
- `sync(nowMs, reachable)`: when `reachable`, the client's copy becomes the server's
  current rules for every flag the server has, and it returns true. Otherwise it returns
  false and the client keeps the copy it had.
- `evaluate(flag, user, attrs)`: when the client's copy has the flag, true if **any** of
  its rules matches the user (so a flag with no rules is off for everyone). Otherwise the
  flag's default; a flag with neither fails.
- `staleMs(nowMs)`: how long ago the last sync that reached the server happened. Before
  any, it fails.

**Rules** are strings:

| Rule                 | Matches when                                   |
| -------------------- | ---------------------------------------------- |
| `user:<name>`        | the user is exactly `<name>`                   |
| `attr:<key>=<value>` | `attrs` has `<key>` with exactly `<value>`     |
| `percent:<n>`        | the user's bucket for this flag is less than n |

A rule's kind ends at its first `:`, so `user:a:b` names the user `a:b`. The key ends at
the first `=`, so a value may contain `=`. `<name>`, `<key>` and `<value>`
are not empty. `<n>` is a whole number from 0 to 100 without leading zeros. Anything
else, including an unknown kind or a rule without its `:`, is malformed.

**Bucket.** Over the characters of `flag + ":" + user`, starting from `h = 0`, take
`h = (h * 31 + <the character's ASCII code>) mod 1000003`; the bucket is `h mod 100`. For
example, the bucket of `bo` for `beta` is 11, so `percent:11` doesn't match and
`percent:12` does.

An empty flag or user fails, in every call and in `defaults`; keys and values in `attrs`
may be anything, empty included. A call that fails changes
nothing. Names, users, keys and values are printable ASCII and case-sensitive.
`0 <= nowMs <= 10^12` and never decreases from one call to the next, versions are at most
10^9, and there are at most 10^4 calls.
