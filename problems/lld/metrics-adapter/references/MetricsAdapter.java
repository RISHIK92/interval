import java.util.*;

// Speaks the legacy agent's `name value unit` lines and feeds the new API: the only code
// that knows the old format and units.
public class MetricsAdapter {
  // The legacy agent's units, each as how many of the new API's base units it is.
  private static final Map<String, Double> TIME_UNITS = Map.of("s", 1000.0, "ms", 1.0, "us", 0.001);
  private static final Map<String, Long> SIZE_UNITS = Map.of("B", 1L, "KB", 1024L, "MB", 1024L * 1024);

  // The new metrics API: it knows only milliseconds and bytes, and each name is one or
  // the other.
  private static final class MetricsApi {
    private final Map<String, Double> ms = new HashMap<>();
    private final Map<String, Long> bytes = new HashMap<>();

    boolean recordMs(String name, double value) {
      if (bytes.containsKey(name)) return false;
      ms.put(name, value);
      return true;
    }

    boolean recordBytes(String name, long size) {
      if (ms.containsKey(name)) return false;
      bytes.put(name, size);
      return true;
    }

    Double ms(String name) {
      return ms.get(name);
    }

    Long size(String name) {
      return bytes.get(name);
    }

    List<String> names() {
      List<String> all = new ArrayList<>(ms.keySet());
      all.addAll(bytes.keySet());
      Collections.sort(all);
      return all;
    }
  }

  private final MetricsApi api = new MetricsApi();

  public boolean ingestLegacy(String line) {
    if (line.isEmpty()) throw new IllegalArgumentException("empty line");
    return ingest(line);
  }

  public Double gaugeMs(String name) {
    named(name);
    return api.ms(name);
  }

  public Long gaugeBytes(String name) {
    named(name);
    return api.size(name);
  }

  public List<String> names() {
    return api.names();
  }

  // The extension round: a batch of lines, each as ingestLegacy takes it.
  public long ingestBatch(List<String> lines) {
    long good = 0;
    for (String line : lines) if (ingest(line)) good++;
    return good;
  }

  private boolean ingest(String line) {
    String[] fields = line.split(" ", -1);
    if (fields.length != 3 || fields[0].isEmpty()) return false;
    Long value = number(fields[1]);
    if (value == null) return false;
    Double ms = TIME_UNITS.get(fields[2]);
    if (ms != null) return api.recordMs(fields[0], value * ms);
    Long bytes = SIZE_UNITS.get(fields[2]);
    if (bytes != null) return api.recordBytes(fields[0], value * bytes);
    return false;
  }

  private static Long number(String text) {
    if (text.isEmpty() || text.length() > 9) return null;
    for (char c : text.toCharArray()) if (c < '0' || c > '9') return null;
    return Long.parseLong(text);
  }

  private static void named(String name) {
    if (name.isEmpty()) throw new IllegalArgumentException("empty name");
  }
}
