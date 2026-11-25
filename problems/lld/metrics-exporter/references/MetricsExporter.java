import java.util.*;
import java.util.function.Supplier;

public class MetricsExporter {
  private static final long[] BOUNDS = {10, 100, 1000};

  private static void word(String text, String extra) {
    if (text.isEmpty()) throw new IllegalArgumentException("empty");
    for (char c : text.toCharArray()) {
      boolean ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_'
          || extra.indexOf(c) >= 0;
      if (!ok) throw new IllegalArgumentException("a character a name, tag key or tag value can't have");
    }
  }

  // A sample is one exported number: its name, the tags it adds to its series' tags, and
  // its value. A metric kind decides its samples; a format decides how one is written.
  private record Sample(String name, List<String[]> extra, long value) {}

  private interface Metric {
    String kind();

    void add(long value);

    List<Sample> samples(String name);
  }

  private static final class Counter implements Metric {
    private long total = 0;

    public String kind() {
      return "counter";
    }

    public void add(long by) {
      total += by;
    }

    public List<Sample> samples(String name) {
      return List.of(new Sample(name, List.of(), total));
    }
  }

  private static final class Histogram implements Metric {
    private final long[] buckets = new long[BOUNDS.length];
    private long count = 0;
    private long sum = 0;

    public String kind() {
      return "histogram";
    }

    public void add(long val) {
      for (int i = 0; i < BOUNDS.length; i++) if (val <= BOUNDS[i]) buckets[i]++;
      count++;
      sum += val;
    }

    public List<Sample> samples(String name) {
      List<Sample> out = new ArrayList<>();
      for (int i = 0; i < BOUNDS.length; i++)
        out.add(new Sample(name + "_bucket", List.<String[]>of(new String[] {"le", Long.toString(BOUNDS[i])}), buckets[i]));
      out.add(new Sample(name + "_bucket", List.<String[]>of(new String[] {"le", "+Inf"}), count));
      out.add(new Sample(name + "_sum", List.of(), sum));
      out.add(new Sample(name + "_count", List.of(), count));
      return out;
    }
  }

  private static final class Gauge implements Metric {
    private long level = 0;

    public String kind() {
      return "gauge";
    }

    public void add(long val) {
      level = val;
    }

    public List<Sample> samples(String name) {
      return List.of(new Sample(name, List.of(), level));
    }
  }

  // The bridge's other side: how a sample is written, whatever kind it came from.
  private interface Format {
    List<String> header(String name, String kind);

    String line(Sample sample, List<String[]> tags, String kind);
  }

  private static final class PrometheusFormat implements Format {
    public List<String> header(String name, String kind) {
      return List.of("# TYPE " + name + " " + kind);
    }

    public String line(Sample sample, List<String[]> tags, String kind) {
      if (tags.isEmpty()) return sample.name() + " " + sample.value();
      StringJoiner parts = new StringJoiner(",");
      for (String[] t : tags) parts.add(t[0] + "=\"" + t[1] + "\"");
      return sample.name() + "{" + parts + "} " + sample.value();
    }
  }

  private static final class StatsdFormat implements Format {
    public List<String> header(String name, String kind) {
      return List.of();
    }

    public String line(Sample sample, List<String[]> tags, String kind) {
      String text = sample.name() + ":" + sample.value() + "|" + (kind.equals("gauge") ? "g" : "c");
      if (!tags.isEmpty()) {
        StringJoiner parts = new StringJoiner(",");
        for (String[] t : tags) parts.add(t[0] + ":" + t[1]);
        text += "|#" + parts;
      }
      return text;
    }
  }

  private static Format pick(String format) {
    switch (format) {
      case "prometheus":
        return new PrometheusFormat();
      case "statsd":
        return new StatsdFormat();
      default:
        throw new IllegalArgumentException("unknown format");
    }
  }

  private record Series(List<String[]> tags, Metric metric) {}

  // The bridge: metric kinds and export formats vary on their own. Each series keeps its
  // numbers once; scraping asks the kind for its samples and hands each one to whichever
  // format is current.
  private Format format;
  private final Map<String, String> kinds = new HashMap<>();
  // name -> tag text -> series, both in character-code order
  private final TreeMap<String, TreeMap<String, Series>> series = new TreeMap<>();

  public MetricsExporter(String format) {
    this.format = pick(format);
  }

  public void counter(String name, long by, Map<String, String> tags) {
    if (by < 0) throw new IllegalArgumentException("a counter only goes up");
    seriesFor(name, tags, "counter", Counter::new).add(by);
  }

  public void observe(String name, long val, Map<String, String> tags) {
    if (tags.containsKey("le")) throw new IllegalArgumentException("le is the histogram's own tag");
    seriesFor(name, tags, "histogram", Histogram::new).add(val);
  }

  public List<String> scrape() {
    List<String> out = new ArrayList<>();
    for (Map.Entry<String, TreeMap<String, Series>> byName : series.entrySet()) {
      out.addAll(format.header(byName.getKey(), kinds.get(byName.getKey())));
      for (Series found : byName.getValue().values()) {
        for (Sample sample : found.metric().samples(byName.getKey())) {
          List<String[]> tags = new ArrayList<>(found.tags());
          tags.addAll(sample.extra());
          out.add(format.line(sample, tags, found.metric().kind()));
        }
      }
    }
    return out;
  }

  public void switchFormat(String format) {
    this.format = pick(format);
  }

  // The extension round: a third kind. Of the formats, only StatsD's letter changed.
  public void gauge(String name, long val, Map<String, String> tags) {
    seriesFor(name, tags, "gauge", Gauge::new).add(val);
  }

  private Metric seriesFor(String name, Map<String, String> tags, String kind, Supplier<Metric> make) {
    word(name, "");
    for (Map.Entry<String, String> e : tags.entrySet()) {
      word(e.getKey(), "");
      word(e.getValue(), "-.");
    }
    if (!kinds.getOrDefault(name, kind).equals(kind)) throw new IllegalArgumentException("another kind's name");
    List<String[]> ordered = new ArrayList<>();
    StringJoiner key = new StringJoiner(",");
    for (Map.Entry<String, String> e : new TreeMap<>(tags).entrySet()) {
      ordered.add(new String[] {e.getKey(), e.getValue()});
      key.add(e.getKey() + "=" + e.getValue());
    }
    Series found = series.computeIfAbsent(name, n -> new TreeMap<>())
        .computeIfAbsent(key.toString(), k -> new Series(ordered, make.get()));
    kinds.put(name, kind);
    return found.metric();
  }
}
