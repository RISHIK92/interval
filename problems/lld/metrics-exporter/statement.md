# Metrics exporters

> PROVISIONAL (LLD practice batch 7c, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A service keeps its counters and histograms once and exposes them to whichever monitoring
system scrapes it: Prometheus or a StatsD agent. Metric kinds and export formats vary
independently, so switching format re-renders exactly the same data.

A **series** is a metric name together with a set of tags (key to value). Each name belongs
to the kind of the first call that created it, and every tag set under it is its own series.

- `MetricsExporter(format)`: no series; exports in `format`, `"prometheus"` or `"statsd"`
  (case matters). Any other format fails.
- `counter(name, by, tags)`: adds `by` to the counter series, creating it at 0 first. A
  negative `by` fails (a counter only goes up); `by` may be 0, which creates the series.
- `observe(name, val, tags)`: records `val` in the histogram series. A histogram has the
  fixed bucket bounds 10, 100 and 1000 and a last bucket `+Inf`; buckets are cumulative, so
  a value counts in every bucket whose bound is at least the value (all of them for `+Inf`).
  It also keeps the count and the sum of its values. A tag key `le` fails here: it is the
  histogram's own (a counter may have one).
- `scrape()`: every series written in the current format, as a list of lines.
- `switchFormat(format)`: exports in `format` from now on. An unknown format fails.

A name or tag key is one or more ASCII letters, digits and `_`; a tag value may also have
`-` and `.`. Anything else, an empty one included, fails. Using a name with the other kind
fails too. A call that fails changes nothing. Names and tags are case-sensitive and at
most 30 characters long.

**Samples.** A counter series gives one sample: its name and its total. A histogram series
named `h` gives six, in this order: `h_bucket` with the extra tag `le` = `10`, `100`,
`1000` and `+Inf` (the bucket counts), then `h_sum` and `h_count`. A sample's tags are its
series' tags sorted by key (character code), followed by the extra `le` tag, if any.

**Formats.** With tags `t1=v1`, `t2=v2` and value `5`:

| Format       | A sample                  | Without tags | Before each name's series |
| ------------ | ------------------------- | ------------ | ------------------------- |
| `prometheus` | `name{t1="v1",t2="v2"} 5` | `name 5`     | `# TYPE <name> <kind>`    |
| `statsd`     | `name:5\|c\|#t1:v1,t2:v2` | `name:5\|c`  | nothing                   |

where `<kind>` is `counter` or `histogram`, and every StatsD sample uses `c`.

**Order.** Names in character-code order. Under a name, its series ordered by their tags
written `key=value`, sorted by key and joined by `,` (character code; a series without
tags writes `""`, so it comes first). Each series' samples are together, in the order above.

Values are integers: `0 <= by <= 10^9`, `-10^9 <= val <= 10^9`. A series has at most 5
tags, and there are at most 10^4 calls.

For example, after `counter("hits", 2, {"svc": "api"})` and `observe("lat", 7, {})`,
Prometheus format scrapes `# TYPE hits counter`, `hits{svc="api"} 2`, `# TYPE lat
histogram`, `lat_bucket{le="10"} 1`, `lat_bucket{le="100"} 1`, `lat_bucket{le="1000"} 1`,
`lat_bucket{le="+Inf"} 1`, `lat_sum 7`, `lat_count 1`. StatsD scrapes `hits:2|c|#svc:api`,
`lat_bucket:1|c|#le:10` and so on, ending with `lat_count:1|c`.
