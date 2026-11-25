import java.util.*;

public class MetricRegistry {
  private static final long MAX_STEP = 1_000_000_000L;
  private static final long MAX_READING = 1_000_000_000_000L;
  private final Map<String, Long> counters = new HashMap<>();
  private final Map<String, Long> gauges = new HashMap<>();

  public MetricRegistry() {}

  // A name belongs to one kind for good: the other kind's map must not hold it.
  private static void claim(String name, Map<String, Long> other) {
    if (name.isEmpty() || other.containsKey(name))
      throw new IllegalArgumentException("a metric needs a non-empty name of its own kind");
  }

  public long inc(String name, long by) {
    if (by < 1 || by > MAX_STEP) throw new IllegalArgumentException("a counter goes up by 1 to 10^9");
    claim(name, gauges);
    long value = counters.getOrDefault(name, 0L) + by;
    counters.put(name, value);
    return value;
  }

  public void gauge(String name, long value) {
    if (value < -MAX_READING || value > MAX_READING)
      throw new IllegalArgumentException("a gauge reads within -10^12 and 10^12");
    claim(name, counters);
    gauges.put(name, value);
  }

  public Long read(String name) {
    return counters.containsKey(name) ? counters.get(name) : gauges.get(name);
  }

  public List<String> names() {
    List<String> out = new ArrayList<>(counters.keySet());
    out.addAll(gauges.keySet());
    Collections.sort(out);
    return out;
  }

  // The extension round.
  public Map<String, Long> snapshotAndReset() {
    Map<String, Long> snapshot = new HashMap<>(counters);
    counters.replaceAll((name, value) -> 0L);
    return snapshot;
  }
}
