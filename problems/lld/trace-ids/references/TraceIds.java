import java.util.*;

// The process's one ID source. Every caller shares this instance, so the last timestamp
// and its sequence live here and nowhere else: two sources on one node could issue the
// same ID, which is why there is only ever one.
public class TraceIds {
  private static final long MAX_NODE = 1023;
  private static final long MAX_MS = 1_000_000_000_000L;
  private static final long PER_MS = 1000; // sequences 000 to 999 in one millisecond
  private static final int[] WIDTHS = {13, 4, 3}; // timestamp, node, sequence

  private final long node;
  private long ms = -1;
  private long sequence = 0;
  private long count = 0;

  public TraceIds(long nodeId) {
    if (nodeId < 0 || nodeId > MAX_NODE) throw new IllegalArgumentException("node out of range");
    this.node = nodeId;
  }

  public String nextId(long nowMs) {
    if (nowMs < 0 || nowMs > MAX_MS) throw new IllegalArgumentException("time out of range");
    if (nowMs > ms) {
      ms = nowMs;
      sequence = 0;
    } else if (sequence + 1 < PER_MS) {
      // The same millisecond, or a clock that went backwards: stay on the last one.
      sequence += 1;
    } else {
      // A full millisecond borrows the next one, so IDs keep sorting in issue order.
      ms += 1;
      sequence = 0;
    }
    count += 1;
    return String.format("%013d-%04d-%03d", ms, node, sequence);
  }

  public long issued() {
    return count;
  }

  public long lastMs() {
    return ms;
  }

  // The extension round: reading an ID back.
  public List<Long> decode(String traceId) {
    String[] parts = traceId.split("-", -1);
    if (parts.length != WIDTHS.length) throw new IllegalArgumentException("not a trace ID");
    List<Long> values = new ArrayList<>();
    for (int i = 0; i < parts.length; i++) {
      if (parts[i].length() != WIDTHS[i] || !parts[i].matches("[0-9]+"))
        throw new IllegalArgumentException("not a trace ID");
      values.add(Long.parseLong(parts[i]));
    }
    if (values.get(1) > MAX_NODE) throw new IllegalArgumentException("node out of range");
    return values;
  }
}
