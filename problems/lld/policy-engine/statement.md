# Access policy engine

> PROVISIONAL (LLD practice batch 8d, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Access to an internal platform is governed by policies written as text, one rule each.
The engine parses them and decides requests: who (a user and their roles) wants to do
what (an action) to which resource, at what hour. An explicit deny always wins over any
allow, and every decision names the policy that made it.

A policy's text is four or six words, separated by one or more spaces (spaces at either end are ignored):

```text
<effect> <role> <action> <resource> [during <from>-<to>]
allow    deployer  deploy  svc/*       during 9-17
```

| Word         | Meaning                                                                                                                                                                                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<effect>`   | `allow` or `deny`                                                                                                                                                                                                                                                                       |
| `<role>`     | `*` matches every request; any other word matches requests whose roles include it                                                                                                                                                                                                       |
| `<action>`   | `*` matches every action; any other word matches that action only                                                                                                                                                                                                                       |
| `<resource>` | a pattern for the whole resource: `*` matches any run of characters (possibly empty, `/` included), `{user}` matches the requesting user's name exactly (even if it holds a `*`), and every other character matches itself. A `{` or `}` that isn't part of `{user}` makes the text bad |
| `during`     | `<from>` and `<to>` are one or two decimal digits with `0 <= from < to <= 24`; the policy matches hours `from <= hour < to`. Without it, every hour                                                                                                                                     |

- `PolicyEngine()`: no policies.
- `addPolicy(id, text)`: adds the policy and returns `true`. Returns `false`, adding
  nothing, when a policy with this `id` exists. Bad text fails, even for a taken `id`.
- `removePolicy(id)`: removes the policy and returns `true`, or returns `false` when there's
  none with this `id`. Its `id` can then be used again; a re-added policy counts as the
  newest.
- `decide(user, roles, action, resource, hour)`: the decision for the request:
  1. If any policy matches it (role, action, resource and hour all match) and is a
     `deny`, `"deny:<id>"` naming the earliest-added such policy.
  2. Otherwise, if any `allow` policy matches, `"allow:<id>"` naming the earliest-added one.
  3. Otherwise `"no-match"`.

Words, names and ids are printable ASCII and case-sensitive. An empty `id`, `user`,
`action`, `resource` or role in `roles` fails, as does an `hour` outside 0 to 23. A call
that fails changes nothing. There are at most 10^4 calls, and texts, resources and
names are at most 100 characters.

For example, with `addPolicy("p1", "allow dev * repo/{user}/*")` and
`addPolicy("p2", "deny * push repo/*/main")`, `decide("ann", ["dev"], "push",
"repo/ann/x", 12)` returns `"allow:p1"` and `decide("ann", ["dev"], "push",
"repo/ann/main", 12)` returns `"deny:p2"`.
