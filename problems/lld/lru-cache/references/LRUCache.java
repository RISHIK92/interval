import java.util.*;

public class LRUCache {
  private final long capacity;
  // Access order: iteration starts at the least recently used.
  private final LinkedHashMap<String, Long> entries = new LinkedHashMap<>(16, 0.75f, true);

  public LRUCache(long capacity) {
    if (capacity < 1) throw new IllegalArgumentException("capacity must be at least 1");
    this.capacity = capacity;
  }

  public synchronized Long lookup(String key) {
    return entries.get(key);
  }

  public synchronized void put(String key, long value) {
    if (value < 0) throw new IllegalArgumentException("negative value");
    entries.put(key, value);
    if (entries.size() > capacity) entries.remove(entries.keySet().iterator().next());
  }

  public synchronized long size() {
    return entries.size();
  }

  public synchronized List<String> keys() {
    List<String> out = new ArrayList<>(entries.keySet());
    Collections.reverse(out);
    return out;
  }
}
