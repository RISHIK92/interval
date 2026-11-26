# Load balancing strategies

> PROVISIONAL (LLD practice batch 8a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A load balancer sends each new connection to one of its backends. How it chooses is a
strategy, and operators switch strategies while traffic is flowing, so switching must
never lose track of the connections that are already open.

| Strategy                 | Each pick takes                                                                                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"round-robin"`          | the backend after the one this strategy picked last, in the order the backends were added, wrapping around; its first pick takes the first backend added                                                          |
| `"least-connections"`    | the backend with the fewest open connections; weights don't count                                                                                                                                                 |
| `"weighted-round-robin"` | smooth weighted round robin: every backend's current weight grows by its weight, the one with the largest current weight is picked, and the picked one's current weight drops by the total weight of all backends |

Ties go to the backend added first. Every current weight starts at 0, including the
current weight of a backend added later.

- `Balancer(strategy)`: no backends, picking with a strategy from the table (case
  matters). Any other strategy fails.
- `addBackend(name, weight)`: adds a backend with no open connections, after the ones
  already added. An empty name, a name already added, or a weight outside 1 to 100 fails.
- `pick()`: picks a backend with the current strategy, opens a connection to it, and
  returns its name. It fails when there are no backends.
- `done(backend)`: closes one of the backend's open connections. An unknown backend, or
  one with no open connections, fails.
- `useStrategy(strategy)`: switches to a strategy from the table, which starts fresh, as
  if the balancer had just been made with it: round robin's next pick is the first
  backend, and every current weight is back to 0. Open connections are kept. Switching
  to the strategy already in use restarts it too. Any other strategy fails.

A call that fails changes nothing. Names are printable ASCII and case-sensitive, there are
at most 100 backends, and there are at most 10^4 calls.

For example, with `"weighted-round-robin"` and backends `a` (weight 5), `b` and `c` (1
each), seven picks give `a`, `a`, `b`, `a`, `c`, `a`, `a`. Switching to
`"least-connections"` then picks `b`: it has one open connection, `c` has one, and `a`
has five.
