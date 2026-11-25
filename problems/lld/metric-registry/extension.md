# Metric registry: snapshots (extension round)

> PROVISIONAL (LLD practice batch A2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A metrics agent now scrapes the registry once a minute and wants each counter's count since
its last scrape, not since the service started.

- `snapshotAndReset()`: returns a map from every counter's name to its current value, then
  sets every counter to 0. The counters still exist: `read` gives 0, `names` lists them, and
  they are still counters, so `gauge` on one still fails. Gauges are neither in the map nor
  changed. With no counters the map is empty.
