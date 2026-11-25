import java.util.*;

public class DiskQuota {
  private final long limit;
  private long total = 0;
  // Only owners holding more than 0 bytes, in name order.
  private final TreeMap<String, Long> held = new TreeMap<>();
  private Long soft = null;

  public DiskQuota(long limitBytes) {
    if (limitBytes < 0) throw new IllegalArgumentException("the limit can't be negative");
    this.limit = limitBytes;
  }

  public boolean reserve(String owner, long bytes) {
    if (bytes < 1) throw new IllegalArgumentException("reserve at least one byte");
    if (bytes > limit - total) return false;
    held.put(owner, used(owner) + bytes);
    total += bytes;
    return true;
  }

  public void release(String owner, long bytes) {
    if (bytes < 1) throw new IllegalArgumentException("release at least one byte");
    long has = used(owner);
    if (bytes > has) throw new IllegalArgumentException("more than the owner holds");
    if (has == bytes) held.remove(owner);
    else held.put(owner, has - bytes);
    total -= bytes;
  }

  public long used(String owner) {
    return held.getOrDefault(owner, 0L);
  }

  public long free() {
    return limit - total;
  }

  // The extension round.
  public void softLimit(long bytes) {
    if (bytes < 0) throw new IllegalArgumentException("the soft limit can't be negative");
    soft = bytes;
  }

  public List<String> warnings() {
    List<String> out = new ArrayList<>();
    if (soft == null) return out;
    for (Map.Entry<String, Long> e : held.entrySet()) if (e.getValue() > soft) out.add(e.getKey());
    return out;
  }
}
