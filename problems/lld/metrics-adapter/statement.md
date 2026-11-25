# Legacy metrics adapter

> PROVISIONAL (LLD practice batch 7a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

An old monitoring agent reports gauges as text lines in mixed units. The new metrics API
only knows milliseconds and bytes. Build the adapter between them: it takes the agent's
lines and answers in the new API's units.

A legacy line is three fields separated by single spaces: `name value unit`, for example
`"req.latency 250 ms"`. It's taken only when all of these hold:

- there are exactly three fields, none empty (so a doubled, leading or trailing space
  refuses the line);
- `value` is 1 to 9 decimal digits (`"007"` is 7; no sign, point or exponent);
- `unit` is one of the six in the table, exactly (case matters).

| Unit | Kind | In the new API            |
| ---- | ---- | ------------------------- |
| `s`  | time | value × 1000 milliseconds |
| `ms` | time | value milliseconds        |
| `us` | time | value ÷ 1000 milliseconds |
| `B`  | size | value bytes               |
| `KB` | size | value × 1024 bytes        |
| `MB` | size | value × 1024 × 1024 bytes |

A name's kind is set by the first line taken for it: a later line that gives the name
the other kind is refused. Otherwise each line taken replaces the name's value.

- `MetricsAdapter()`: no gauges.
- `ingestLegacy(line)`: takes the line and returns true, or returns false and changes
  nothing when the line isn't taken (as above). An empty line fails.
- `gaugeMs(name)`: the name's value in milliseconds, or null when the name has no time
  value (unknown, or a size). It's judged to within 10^-9, relative to its size.
- `gaugeBytes(name)`: the name's value in bytes, or null when the name has no size value.
- `names()`: every name with a value, in ascending order by character code (`"B"` before
  `"a"`).

An empty name fails in `gaugeMs` and `gaugeBytes`. Lines and names are printable ASCII and
case-sensitive, lines are at most 100 characters, and there are at most 10^4 calls.

For example, after `"heap 3 MB"` and `"db.wait 1500 us"`, `gaugeBytes("heap")` is 3145728,
`gaugeMs("db.wait")` is 1.5, `gaugeMs("heap")` is null, and `"heap 2 s"` is refused.
