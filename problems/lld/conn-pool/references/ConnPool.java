import java.util.*;

// Every public method is synchronized, so two threads can never take the same idle
// connection or both grow the pool past its maximum.
public class ConnPool {
  private static final long MAX_SIZE = 1000;

  private final long max;
  // Every connection ever made, including the discarded ones.
  private final Set<String> made = new HashSet<>();
  // Most recently released last: reusing from the end keeps the warmest connection busy
  // and lets the coldest ones age out.
  private final Deque<String> idle = new ArrayDeque<>();
  private final Map<String, String> held = new HashMap<>();

  public ConnPool(long maxSize) {
    if (maxSize < 1 || maxSize > MAX_SIZE) throw new IllegalArgumentException("maxSize is 1 to 1000");
    max = maxSize;
  }

  private void known(String conn) {
    if (!made.contains(conn)) throw new NoSuchElementException("not a connection this pool made");
  }

  public synchronized String acquire(String client) {
    if (client.isEmpty()) throw new IllegalArgumentException("clients are named");
    String conn = idle.pollLast();
    if (conn == null) {
      if (held.size() >= max) return null;
      conn = "conn-" + (made.size() + 1);
      made.add(conn);
    }
    held.put(conn, client);
    return conn;
  }

  public synchronized boolean release(String conn) {
    known(conn);
    if (held.remove(conn) == null) return false;
    idle.addLast(conn);
    return true;
  }

  public synchronized boolean invalidate(String conn) {
    known(conn);
    return idle.remove(conn) || held.remove(conn) != null;
  }

  public synchronized long created() {
    return made.size();
  }

  public synchronized long idle() {
    return idle.size();
  }

  // The extension round: close the coldest idle connections past a limit.
  public synchronized long shrink(long maxIdle) {
    if (maxIdle < 0) throw new IllegalArgumentException("maxIdle is not negative");
    long closing = Math.max(idle.size() - maxIdle, 0);
    for (long i = 0; i < closing; i++) idle.pollFirst();
    return closing;
  }
}
