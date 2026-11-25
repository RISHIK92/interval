const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const NAME = /^[A-Za-z0-9_]+$/;
const VALUE = /^[A-Za-z0-9_.-]+$/;
const BOUNDS = [10, 100, 1000];

function word(text: string, allowed: RegExp): void {
  if (!allowed.test(text))
    throw new RangeError(
      "a name, tag key or tag value with a character it can't have",
    );
}

type Tags = [string, string][];

// A sample is one exported number: its name, the tags it adds to its series' tags, and
// its value. A metric kind decides its samples; a format decides how one is written.
interface Sample {
  name: string;
  extra: Tags;
  value: number;
}

interface Metric {
  readonly kind: string;
  add(value: number): void;
  samples(name: string): Sample[];
}

class Counter implements Metric {
  readonly kind = "counter";
  private total = 0;

  add(by: number): void {
    this.total += by;
  }

  samples(name: string): Sample[] {
    return [{ name, extra: [], value: this.total }];
  }
}

class Histogram implements Metric {
  readonly kind = "histogram";
  private readonly buckets = BOUNDS.map(() => 0);
  private count = 0;
  private sum = 0;

  add(val: number): void {
    BOUNDS.forEach((bound, i) => {
      if (val <= bound) this.buckets[i] = (this.buckets[i] ?? 0) + 1;
    });
    this.count += 1;
    this.sum += val;
  }

  samples(name: string): Sample[] {
    const out: Sample[] = BOUNDS.map((bound, i) => ({
      name: `${name}_bucket`,
      extra: [["le", String(bound)]],
      value: this.buckets[i] ?? 0,
    }));
    out.push({
      name: `${name}_bucket`,
      extra: [["le", "+Inf"]],
      value: this.count,
    });
    out.push({ name: `${name}_sum`, extra: [], value: this.sum });
    out.push({ name: `${name}_count`, extra: [], value: this.count });
    return out;
  }
}

class Gauge implements Metric {
  readonly kind = "gauge";
  private level = 0;

  add(val: number): void {
    this.level = val;
  }

  samples(name: string): Sample[] {
    return [{ name, extra: [], value: this.level }];
  }
}

// The bridge's other side: how a sample is written, whatever kind it came from.
interface Format {
  header(name: string, kind: string): string[];
  line(sample: Sample, tags: Tags, kind: string): string;
}

class PrometheusFormat implements Format {
  header(name: string, kind: string): string[] {
    return [`# TYPE ${name} ${kind}`];
  }

  line(sample: Sample, tags: Tags, _kind: string): string {
    if (tags.length === 0) return `${sample.name} ${String(sample.value)}`;
    return `${sample.name}{${tags.map(([k, v]) => `${k}="${v}"`).join(",")}} ${String(sample.value)}`;
  }
}

class StatsdFormat implements Format {
  header(_name: string, _kind: string): string[] {
    return [];
  }

  line(sample: Sample, tags: Tags, kind: string): string {
    let text = `${sample.name}:${String(sample.value)}|${kind === "gauge" ? "g" : "c"}`;
    if (tags.length > 0)
      text += `|#${tags.map(([k, v]) => `${k}:${v}`).join(",")}`;
    return text;
  }
}

const FORMATS: Record<string, () => Format> = {
  prometheus: () => new PrometheusFormat(),
  statsd: () => new StatsdFormat(),
};

function pick(format: string): Format {
  const make = Object.hasOwn(FORMATS, format) ? FORMATS[format] : undefined;
  if (make === undefined) throw new RangeError("unknown format");
  return make();
}

interface Series {
  tags: Tags;
  metric: Metric;
}

// The bridge: metric kinds and export formats vary on their own. Each series keeps its
// numbers once; scraping asks the kind for its samples and hands each one to whichever
// format is current.
export class MetricsExporter {
  private format: Format;
  private readonly kinds = new Map<string, string>();
  // name -> tag text -> series
  private readonly series = new Map<string, Map<string, Series>>();

  constructor(format: string) {
    this.format = pick(format);
  }

  counter(name: string, by: number, tags: Record<string, string>): void {
    if (by < 0) throw new RangeError("a counter only goes up");
    this.seriesFor(name, tags, "counter", () => new Counter()).add(by);
  }

  observe(name: string, val: number, tags: Record<string, string>): void {
    if (Object.hasOwn(tags, "le"))
      throw new RangeError("le is the histogram's own tag");
    this.seriesFor(name, tags, "histogram", () => new Histogram()).add(val);
  }

  scrape(): string[] {
    const out: string[] = [];
    for (const name of [...this.series.keys()].sort(byCode)) {
      out.push(...this.format.header(name, this.kinds.get(name) ?? ""));
      const series = this.series.get(name) ?? new Map<string, Series>();
      for (const key of [...series.keys()].sort(byCode)) {
        const found = series.get(key);
        if (found === undefined) continue;
        for (const sample of found.metric.samples(name))
          out.push(
            this.format.line(
              sample,
              [...found.tags, ...sample.extra],
              found.metric.kind,
            ),
          );
      }
    }
    return out;
  }

  switchFormat(format: string): void {
    this.format = pick(format);
  }

  // The extension round: a third kind. Of the formats, only StatsD's letter changed.
  gauge(name: string, val: number, tags: Record<string, string>): void {
    this.seriesFor(name, tags, "gauge", () => new Gauge()).add(val);
  }

  private seriesFor(
    name: string,
    tags: Record<string, string>,
    kind: string,
    make: () => Metric,
  ): Metric {
    word(name, NAME);
    for (const [key, value] of Object.entries(tags)) {
      word(key, NAME);
      word(value, VALUE);
    }
    if ((this.kinds.get(name) ?? kind) !== kind)
      throw new RangeError("the name belongs to another kind");
    const ordered = Object.entries(tags).sort((a, b) => byCode(a[0], b[0]));
    const key = ordered.map(([k, v]) => `${k}=${v}`).join(",");
    let series = this.series.get(name);
    if (series === undefined) {
      series = new Map();
      this.series.set(name, series);
    }
    let found = series.get(key);
    if (found === undefined) {
      found = { tags: ordered, metric: make() };
      series.set(key, found);
    }
    this.kinds.set(name, kind);
    return found.metric;
  }
}
