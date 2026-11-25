# Metric registry

> PROVISIONAL (LLD practice batch A2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build a registry of a service's metrics, each known by its name. A metric is one of two
kinds, and its kind is fixed by the first call that names it:

- a **counter** counts events, so it only ever goes up;
- a **gauge** holds the latest reading of something that rises and falls, such as a queue's
  depth.

A name is any non-empty string of printable ASCII; an empty name fails. A name can't be
both a counter and a gauge.

- `MetricRegistry()`: starts with no metrics.
- `inc(name, by)`: adds `by` to the counter `name`, creating it at 0 first if no metric has
  that name, and returns the counter's new value. `by` is from 1 to 10^9, or the call fails.
  It also fails when `name` is a gauge.
- `gauge(name, value)`: sets the gauge `name` to `value`, creating it if no metric has that
  name. `value` is from −10^12 to 10^12, or the call fails. It also fails when `name` is a
  counter.
- `read(name)`: the metric's current value, whatever its kind, or null when no metric has
  that name.
- `names()`: the names of every metric, counters and gauges together, sorted in ascending
  order by character code (`"B"` before `"a"`).

A call that fails changes nothing. There are at most 10^4 calls, so every value stays
below 2^53.
