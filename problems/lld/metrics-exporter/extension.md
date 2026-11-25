# Metrics exporters: gauges (extension round)

> PROVISIONAL (LLD practice batch 7c, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Some numbers go up and down: queue depth, memory in use, temperature. They need a third
metric kind that both formats can export.

- `gauge(name, val, tags)`: sets the gauge series to `val`, creating it first. A gauge keeps
  only its latest value, which may be negative (`-10^9 <= val <= 10^9`).
  - A gauge series gives one sample: its name and its value. Prometheus writes its header
    as `# TYPE <name> gauge`; StatsD writes its samples with `g` where counters have `c`,
    for example `mem:12|g|#host:h0`.
  - Names, tags and failures follow the base rules: a name used by a counter or a
    histogram fails, and so does one of theirs used by a gauge. A gauge may have a tag `le`.
  - Gauges are ordered with every other name and series, as in the base round.
