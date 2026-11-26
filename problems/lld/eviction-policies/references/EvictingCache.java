import java.util.*;

public class EvictingCache {
  // A cached value and its usage history. Every policy reads the same history, so
  // switching never loses it.
  private static final class Entry {
    long value;
    final long entered;
    long used;
    long uses = 1;

    Entry(long value, long stamp) {
      this.value = value;
      this.entered = stamp;
      this.used = stamp;
    }
  }

  // Each strategy only orders entries; the first in its order is evicted.
  private static final Map<String, Comparator<Entry>> POLICIES =
      Map.of(
          "lru", Comparator.comparingLong((Entry e) -> e.used),
          "lfu", Comparator.comparingLong((Entry e) -> e.uses).thenComparingLong(e -> e.used),
          "fifo", Comparator.comparingLong((Entry e) -> e.entered));

  private final long capacity;
  private Comparator<Entry> policy;
  private final Map<String, Entry> entries = new HashMap<>();
  private final Set<String> pinned = new HashSet<>();
  private long clock = 0;

  public EvictingCache(long capacity, String policy) {
    if (capacity < 1 || !POLICIES.containsKey(policy))
      throw new IllegalArgumentException("bad capacity or policy");
    this.capacity = capacity;
    this.policy = POLICIES.get(policy);
  }

  private void use(Entry entry) {
    entry.used = ++clock;
    entry.uses++;
  }

  private void evict() {
    String victim = null;
    for (Map.Entry<String, Entry> e : entries.entrySet()) {
      if (pinned.contains(e.getKey())) continue;
      if (victim == null || policy.compare(e.getValue(), entries.get(victim)) < 0) victim = e.getKey();
    }
    if (victim == null) throw new IllegalStateException("every key is pinned");
    entries.remove(victim);
  }

  public void put(String key, long val) {
    if (key.isEmpty()) throw new IllegalArgumentException("an empty key");
    Entry entry = entries.get(key);
    if (entry != null) {
      entry.value = val;
      use(entry);
      return;
    }
    if (entries.size() >= capacity) evict();
    entries.put(key, new Entry(val, ++clock));
  }

  public Long lookup(String key) {
    if (key.isEmpty()) throw new IllegalArgumentException("an empty key");
    Entry entry = entries.get(key);
    if (entry == null) return null;
    use(entry);
    return entry.value;
  }

  public List<String> keys() {
    List<String> out = new ArrayList<>(entries.keySet());
    Collections.sort(out);
    return out;
  }

  public void switchPolicy(String policy) {
    if (!POLICIES.containsKey(policy)) throw new IllegalArgumentException("unknown policy");
    this.policy = POLICIES.get(policy);
  }

  // The extension round: a pinned key is passed over by every policy.
  public void pinKey(String key) {
    if (!entries.containsKey(key)) throw new IllegalArgumentException("not cached");
    pinned.add(key);
  }
}
