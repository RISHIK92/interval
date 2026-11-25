> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If every metric kind knew how to write itself in every format, how many places would change when a third format arrived?

## Approach

Split the problem into two small hierarchies joined by one narrow interface. A metric kind (counter, histogram) only turns its numbers into samples: a sample name, any extra tags, and a value. A format (Prometheus, StatsD) only writes a sample, plus whatever it puts before each metric name. The exporter holds the current format and, per name, a map from the series' sorted tag text to the kind's object. Scraping walks names and tag texts in character-code order, asks each series for its samples and hands each to the format. Switching format replaces one field, and the data is never touched. Validate everything before creating a series, so a failed call leaves nothing behind.

## Code sketch

```text
interface Metric                  // the abstraction side
  add(value)
  samples(name) -> list of (sampleName, extraTags, value)
interface Format                  // the implementation side
  header(name, kind) -> lines
  line(sample, tags, kind) -> string

class Counter, Histogram implements Metric   // TODO
class Prometheus, Statsd implements Format   // TODO

class MetricsExporter
  format: Format
  kinds: map name -> kind
  series: map name -> (map tagText -> (sortedTags, Metric))

  counter(name, by, tags)     // TODO: by >= 0; seriesFor(...).add
  observe(name, val, tags)    // TODO: no "le" tag; seriesFor(...).add
  scrape() -> list            // TODO: names, then tag texts, in order
  switchFormat(format)        // TODO: replace the Format
  seriesFor(name, tags, kind) // TODO: validate all, then find or create
```
