> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

When `gauge("hits", 7)` arrives and `hits` is already a counter, what does the registry need to know to refuse it, and where is that kept?

## Approach

Keep the metrics private, in two maps by kind: counter names to their counts and gauge names to their readings. Then a name's kind is simply which map holds it. Each writer validates first (the amount's range, a non-empty name, and that the other map doesn't hold the name) and only then writes to its own map, so a refused call leaves both maps as they were and a counter can only be raised by `inc`. `read` looks in both maps, and `names` merges their keys and sorts them.

## Code sketch

```text
class MetricRegistry
  counters: map name -> int
  gauges: map name -> int

  claim(name, other)
    // TODO: fail when name is empty or other holds it
  inc(name, by) -> int
    // TODO: fail unless 1 <= by <= 10^9
    // TODO: claim(name, gauges)
    // TODO: counters[name] = (counters[name] or 0) + by; return it
  gauge(name, value)
    // TODO: fail unless -10^12 <= value <= 10^12
    // TODO: claim(name, counters); gauges[name] = value
  read(name) -> optional<int>
    // TODO: from counters, else from gauges, else null
  names() -> list<string>
    // TODO: both maps' keys, sorted
```
