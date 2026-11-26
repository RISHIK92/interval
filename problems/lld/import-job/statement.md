# Import jobs

> PROVISIONAL (LLD practice batch 8b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Every import runs the same fixed skeleton over its lines: **extract** the fields,
**validate** them, **transform** the valid ones into records, and **load** the records.
Two kinds of import share that skeleton and differ only in how they validate and
transform. A rejected line is never loaded, and the reject says why.

**Extract** (both kinds): the line is split at every `,` into fields. A line that doesn't
give exactly 3 fields is rejected as `fields`.

**`users`** lines are `email,name,age`:

| Check, in this order                                                  | Reject reason |
| --------------------------------------------------------------------- | ------------- |
| `email` has exactly one `@`, with at least one character on each side | `email`       |
| `name` isn't empty                                                    | `name`        |
| `age` is a whole number from 0 to 150                                 | `age`         |

A valid line loads `"user:<email in lowercase>:<name>:<age>"`.

**`events`** lines are `ts,type,user`, with `ts` in seconds:

| Check, in this order                  | Reject reason |
| ------------------------------------- | ------------- |
| `ts` is a whole number from 0 to 10^9 | `ts`          |
| `type` is `click`, `view` or `buy`    | `type`        |
| `user` isn't empty                    | `user`        |

A valid line loads `"event:<ts in milliseconds>:<type>:<user>"`.

A whole number is written in decimal digits only, without leading zeros (`0` itself is
fine). Only the first failing check gives the reason. Fields are kept as given, spaces
included, apart from the lowercased email.

- `ImportJob(kind)`: `"users"` or `"events"` (case matters); anything else fails.
- `runImport(lines)`: runs one import over the lines, in order, and returns
  `{"read": <lines>, "loaded": <records loaded>, "rejected": <lines rejected>}`. Runs are
  numbered from 1, empty runs included. An empty line fails the whole run: it loads
  nothing and isn't numbered.
- `loaded()`: every record loaded so far, across runs, in load order.
- `rejects()`: every rejected line so far, in order, as `"<run>:<line> <reason>"`, where
  `<line>` is the line's position in its run, from 1.

A call that fails changes nothing. Lines are printable ASCII, a run has at most 1000
lines, and there are at most 10^4 lines in all.

For example, a `users` job given `["Ana@Example.com,Ana,34", "bo@example.com,,20"]`
returns `{"read": 2, "loaded": 1, "rejected": 1}`. Then `loaded()` returns
`["user:ana@example.com:Ana:34"]` and `rejects()` returns `["1:2 name"]`.
