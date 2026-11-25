"use strict";

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const NAME = /^[A-Za-z0-9_]+$/;
const VALUE = /^[A-Za-z0-9_.-]+$/;
const BOUNDS = [10, 100, 1000];

function word(text, allowed) {
  if (!allowed.test(text))
    throw new RangeError(
      "a name, tag key or tag value with a character it can't have",
    );
}

// A metric kind turns its numbers into samples: a name, the tags it adds to its series'
// tags, and a value. How a sample is written is the format's business.
class Counter {
  kind = "counter";
  #total = 0;

  add(by) {
    this.#total += by;
  }

  samples(name) {
    return [{ name, extra: [], value: this.#total }];
  }
}

class Histogram {
  kind = "histogram";
  #buckets = BOUNDS.map(() => 0);
  #count = 0;
  #sum = 0;

  add(val) {
    BOUNDS.forEach((bound, i) => {
      if (val <= bound) this.#buckets[i] += 1;
    });
    this.#count += 1;
    this.#sum += val;
  }

  samples(name) {
    const out = BOUNDS.map((bound, i) => ({
      name: `${name}_bucket`,
      extra: [["le", String(bound)]],
      value: this.#buckets[i],
    }));
    out.push({
      name: `${name}_bucket`,
      extra: [["le", "+Inf"]],
      value: this.#count,
    });
    out.push({ name: `${name}_sum`, extra: [], value: this.#sum });
    out.push({ name: `${name}_count`, extra: [], value: this.#count });
    return out;
  }
}

class Gauge {
  kind = "gauge";
  #level = 0;

  add(val) {
    this.#level = val;
  }

  samples(name) {
    return [{ name, extra: [], value: this.#level }];
  }
}

// The bridge's other side: how a sample is written, whatever kind it came from.
class PrometheusFormat {
  header(name, kind) {
    return [`# TYPE ${name} ${kind}`];
  }

  line(sample, tags) {
    if (tags.length === 0) return `${sample.name} ${sample.value}`;
    return `${sample.name}{${tags.map(([k, v]) => `${k}="${v}"`).join(",")}} ${sample.value}`;
  }
}

class StatsdFormat {
  header() {
    return [];
  }

  line(sample, tags, kind) {
    let text = `${sample.name}:${sample.value}|${kind === "gauge" ? "g" : "c"}`;
    if (tags.length > 0)
      text += `|#${tags.map(([k, v]) => `${k}:${v}`).join(",")}`;
    return text;
  }
}

const FORMATS = new Map([
  ["prometheus", () => new PrometheusFormat()],
  ["statsd", () => new StatsdFormat()],
]);

function pick(format) {
  const make = FORMATS.get(format);
  if (make === undefined) throw new RangeError("unknown format");
  return make();
}

// The bridge: metric kinds and export formats vary on their own. Each series keeps its
// numbers once; scraping asks the kind for its samples and hands each one to whichever
// format is current.
class MetricsExporter {
  #format;
  #kinds = new Map();
  // name -> tag text -> { tags, metric }
  #series = new Map();

  constructor(format) {
    this.#format = pick(format);
  }

  counter(name, by, tags) {
    if (by < 0) throw new RangeError("a counter only goes up");
    this.#seriesFor(name, tags, "counter", () => new Counter()).add(by);
  }

  observe(name, val, tags) {
    if (Object.hasOwn(tags, "le"))
      throw new RangeError("le is the histogram's own tag");
    this.#seriesFor(name, tags, "histogram", () => new Histogram()).add(val);
  }

  scrape() {
    const out = [];
    for (const name of [...this.#series.keys()].sort(byCode)) {
      out.push(...this.#format.header(name, this.#kinds.get(name)));
      const series = this.#series.get(name);
      for (const key of [...series.keys()].sort(byCode)) {
        const { tags, metric } = series.get(key);
        for (const sample of metric.samples(name))
          out.push(
            this.#format.line(sample, [...tags, ...sample.extra], metric.kind),
          );
      }
    }
    return out;
  }

  switchFormat(format) {
    this.#format = pick(format);
  }

  // The extension round: a third kind. Of the formats, only StatsD's letter changed.
  gauge(name, val, tags) {
    this.#seriesFor(name, tags, "gauge", () => new Gauge()).add(val);
  }

  #seriesFor(name, tags, kind, make) {
    word(name, NAME);
    for (const [key, value] of Object.entries(tags)) {
      word(key, NAME);
      word(value, VALUE);
    }
    if ((this.#kinds.get(name) ?? kind) !== kind)
      throw new RangeError("the name belongs to another kind");
    const ordered = Object.entries(tags).sort((a, b) => byCode(a[0], b[0]));
    const key = ordered.map(([k, v]) => `${k}=${v}`).join(",");
    if (!this.#series.has(name)) this.#series.set(name, new Map());
    const series = this.#series.get(name);
    if (!series.has(key)) series.set(key, { tags: ordered, metric: make() });
    this.#kinds.set(name, kind);
    return series.get(key).metric;
  }
}

module.exports = { MetricsExporter };
