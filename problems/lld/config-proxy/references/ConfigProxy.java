import java.util.*;

// Stands in front of the config service with the same job, reading a key, and calls
// through only when its copy is missing or older than the TTL. When the call fails, a
// stale copy is better than nothing.
public class ConfigProxy {
  private static final long MAX_TTL_MS = 1_000_000_000L;

  private static final class Unavailable extends Exception {
    Unavailable(String key) {
      super(key);
    }
  }

  // The slow upstream: it counts every call made to it, and while it's down every call
  // fails.
  private static final class ConfigService {
    final Map<String, String> values = new HashMap<>();
    boolean down = false;
    long calls = 0;

    String fetch(String key) throws Unavailable {
      calls += 1;
      if (down) throw new Unavailable(key);
      return values.get(key);
    }
  }

  private record Entry(String value, long fetchedMs) {}

  private final long ttl;
  private final ConfigService upstream = new ConfigService();
  private final Map<String, Entry> cache = new HashMap<>();

  public ConfigProxy(long ttlMs) {
    if (ttlMs < 1 || ttlMs > MAX_TTL_MS) throw new IllegalArgumentException("ttl out of range");
    ttl = ttlMs;
  }

  public void upstreamSet(String key, String val) {
    given(key);
    given(val);
    upstream.values.put(key, val);
  }

  public String read(String key, long nowMs) {
    given(key);
    Entry kept = cache.get(key);
    if (kept != null && nowMs - kept.fetchedMs() < ttl) return kept.value();
    String value;
    try {
      value = upstream.fetch(key);
    } catch (Unavailable e) {
      return kept == null ? null : kept.value();
    }
    if (value != null) cache.put(key, new Entry(value, nowMs));
    return value;
  }

  public void upstreamDown(boolean down) {
    upstream.down = down;
  }

  public long upstreamFetches() {
    return upstream.calls;
  }

  // The extension round: dropping a copy before its time.
  public void invalidate(String key) {
    given(key);
    cache.remove(key);
  }

  private static void given(String value) {
    if (value.isEmpty()) throw new IllegalArgumentException("empty");
  }
}
