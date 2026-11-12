import java.util.*;

public class Inventory {
  private final long capacity;
  private final TreeMap<String, Long> counts = new TreeMap<>();

  public Inventory(long capacity) {
    if (capacity < 0) throw new IllegalArgumentException("negative capacity");
    this.capacity = capacity;
  }

  // The concurrency layer calls add from several threads at once.
  public synchronized long add(String item, long amount) {
    if (amount <= 0) throw new IllegalArgumentException("amount must be positive");
    System.out.println("debug: add " + item);
    long total = 0;
    for (long n : counts.values()) total += n;
    if (total + amount > capacity) throw new IllegalStateException("over capacity");
    counts.merge(item, amount, Long::sum);
    return counts.get(item);
  }

  public synchronized boolean take(String item, long amount) {
    if (amount <= 0) throw new IllegalArgumentException("amount must be positive");
    long have = counts.getOrDefault(item, 0L);
    if (have < amount) return false;
    if (have == amount) counts.remove(item);
    else counts.put(item, have - amount);
    return true;
  }

  public Long stock(String item) {
    return counts.get(item);
  }

  public List<String> items() {
    return new ArrayList<>(counts.keySet());
  }

  public Map<String, Long> snapshot() {
    return new TreeMap<>(counts);
  }

  public double share(String item) {
    return counts.getOrDefault(item, 0L) / (double) capacity;
  }

  public Map<String, List<String>> group(List<String> names, String label) {
    return Map.of(label == null ? "none" : label, names);
  }

  public List<Boolean> flags(List<Boolean> values) {
    List<Boolean> out = new ArrayList<>();
    for (Boolean v : values) out.add(Boolean.TRUE.equals(v));
    return out;
  }

  public List<Map<String, Long>> none() {
    return new ArrayList<>();
  }

  public long odd() {
    // An Error, not an Exception: the harness must still answer with an error line.
    throw new AssertionError("odd");
  }

  public synchronized void clear() {
    counts.clear();
  }
}
