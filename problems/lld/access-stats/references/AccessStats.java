import java.util.*;

public class AccessStats {
  private static final Set<String> METHODS = Set.of("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE");
  private static final long MAX_LATENCY = 60_000;
  private static final long MAX_TOP = 100;

  private record Request(String path, long status, long latency) {}

  private static Long digits(String text, int most) {
    return text.matches("[0-9]{1," + most + "}") ? Long.parseLong(text) : null;
  }

  // Parsing: one line in, one request or null out. It knows the format and nothing else.
  private static Request parse(String line) {
    String[] parts = line.split(" ", -1);
    if (parts.length != 4 || !METHODS.contains(parts[0]) || !parts[1].startsWith("/")) return null;
    Long status = digits(parts[2], 3);
    Long latency = digits(parts[3], 5);
    if (status == null || status < 100 || status > 599 || latency == null || latency > MAX_LATENCY)
      return null;
    int query = parts[1].indexOf('?');
    return new Request(query < 0 ? parts[1] : parts[1].substring(0, query), status, latency);
  }

  // Aggregation: running totals of what was parsed. It never sees a raw line or a report.
  private static final class Totals {
    long requests, errors;
    final Map<String, List<Long>> latencies = new HashMap<>();
    final Map<String, Long> classes = new HashMap<>();

    void add(Request request) {
      requests++;
      if (request.status() >= 500) errors++;
      latencies.computeIfAbsent(request.path(), path -> new ArrayList<>()).add(request.latency());
      classes.merge(request.status() / 100 + "xx", 1L, Long::sum);
    }
  }

  // Reporting: answers computed from the totals, which it only reads.
  private static List<String> topPaths(Totals totals, long n) {
    List<String> ranked = new ArrayList<>(totals.latencies.keySet());
    ranked.sort(
        Comparator.comparingInt((String path) -> -totals.latencies.get(path).size())
            .thenComparing(Comparator.naturalOrder()));
    return new ArrayList<>(ranked.subList(0, (int) Math.min(n, ranked.size())));
  }

  private static double errorRate(Totals totals) {
    return totals.requests > 0 ? (double) totals.errors / totals.requests : 0.0;
  }

  private static long median(List<Long> latencies) {
    List<Long> sorted = new ArrayList<>(latencies);
    Collections.sort(sorted);
    return sorted.get((sorted.size() - 1) / 2);
  }

  private final Totals totals = new Totals();

  public AccessStats() {}

  public boolean ingest(String line) {
    if (line.isEmpty()) throw new IllegalArgumentException("an empty line");
    Request request = parse(line);
    if (request == null) return false;
    totals.add(request);
    return true;
  }

  public List<String> topPaths(long n) {
    if (n < 1 || n > MAX_TOP) throw new IllegalArgumentException("n is 1 to 100");
    return topPaths(totals, n);
  }

  public double errorRate() {
    return errorRate(totals);
  }

  public long p50(String path) {
    List<Long> latencies = totals.latencies.get(path);
    if (latencies == null) throw new NoSuchElementException("no requests for that path");
    return median(latencies);
  }

  // The extension round.
  public Map<String, Long> byStatusClass() {
    return new HashMap<>(totals.classes);
  }
}
