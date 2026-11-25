# Log sink factory

> PROVISIONAL (LLD practice batch 6a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A logging library lets each service say where its logs go with a short spec string. The
library turns the spec into a sink of the right kind, and from then on the service just
writes lines to it without knowing which kind it has.

- `SinkFactory()`: a factory that has made no sinks.
- `create(spec)`: makes a new sink from `spec` and returns its id, `<kind>-<n>`, where
  `n` counts the sinks of that kind made so far, this one included (`file-1`, `file-2`,
  ...). The specs are:

  | Spec                   | Kind     | Rules                                                                                                           |
  | ---------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
  | `stdout`               | `stdout` | exactly this                                                                                                    |
  | `file:<path>`          | `file`   | the path starts with `/`, doesn't end with `/`, and has no spaces                                               |
  | `syslog:<host>:<port>` | `syslog` | the host is one or more letters, digits, `.` and `-`; the port is 1 to 65535, in decimal, with no leading zeros |

  Any other spec fails. Every call makes a new sink, even for a spec used before.

- `kindOf(sink)`: the kind of the sink with that id.
- `writeLine(sink, line)`: writes `line` to the sink and returns what the sink wrote:

  | Kind     | Writes                                                                                   |
  | -------- | ---------------------------------------------------------------------------------------- |
  | `stdout` | the line as given                                                                        |
  | `file`   | `<path>:<n> <line>`, where `n` counts the lines this sink has written, this one included |
  | `syslog` | `<14><host>:<port> <line>`                                                               |

- `created(kind)`: how many sinks of that kind have been made; 0 for a kind it has never
  made, whatever the name.

An id the factory never returned fails in `kindOf` and `writeLine`. An empty line or kind
fails; `writeLine` fails on an unknown sink before it looks at the line. A call that fails
changes nothing and makes nothing. Specs, ids, kinds and lines are printable ASCII and
case-sensitive, and there are at most 10^4 calls.
