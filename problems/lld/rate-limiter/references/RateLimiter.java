import java.util.*;

public class RateLimiter {
  private final long limit;
  private final long window;
  // Each client's allowed requests, oldest first, and the time of its last call.
  private final Map<String, ArrayDeque<Long>> log = new HashMap<>();
  private final Map<String, Long> last = new HashMap<>();

  public RateLimiter(long limit, long windowMs) {
    if (limit < 1 || windowMs < 1) throw new IllegalArgumentException("limit and window must be at least 1");
    this.limit = limit;
    this.window = windowMs;
  }

  private ArrayDeque<Long> current(String client, long now) {
    Long previous = last.get(client);
    if (previous != null && now < previous) throw new IllegalStateException("time went backwards");
    last.put(client, now);
    ArrayDeque<Long> entries = log.computeIfAbsent(client, k -> new ArrayDeque<>());
    while (!entries.isEmpty() && entries.peekFirst() <= now - window) entries.pollFirst();
    return entries;
  }

  public synchronized boolean allow(String client, long nowMs) {
    ArrayDeque<Long> entries = current(client, nowMs);
    if (entries.size() >= limit) return false;
    entries.addLast(nowMs);
    return true;
  }

  public synchronized long remaining(String client, long nowMs) {
    return limit - current(client, nowMs).size();
  }
}
