// Guards calls to a failing dependency. The breaker checks the time and hands every
// event to its current state object, which says what happens and what comes next.
public class CircuitBreaker {
  private static final long MAX_THRESHOLD = 1000;
  private static final long MAX_COOL_DOWN_MS = 1_000_000_000L;

  // One state's rules. Each event returns the state the breaker is in afterwards, so
  // the breaker itself never asks which state it's in.
  private abstract class State {
    abstract String name();

    State tick(long nowMs) {
      return this;
    }

    boolean allow() {
      return false;
    }

    State success(long nowMs) {
      return this;
    }

    State failure(long nowMs) {
      return this;
    }

    State force(boolean on) {
      return on ? new ForcedOpen() : this;
    }
  }

  private final class Closed extends State {
    private long failures = 0;

    String name() {
      return "closed";
    }

    boolean allow() {
      return true;
    }

    State success(long nowMs) {
      failures = 0;
      return this;
    }

    State failure(long nowMs) {
      failures += 1;
      return failures >= threshold ? new Open(nowMs) : this;
    }
  }

  // Refuses every call until the cool-down has passed; outcomes of calls let through
  // earlier change nothing.
  private final class Open extends State {
    private final long openedMs;

    Open(long openedMs) {
      this.openedMs = openedMs;
    }

    String name() {
      return "open";
    }

    State tick(long nowMs) {
      return nowMs >= openedMs + coolDownMs ? new HalfOpen() : this;
    }
  }

  // Lets one trial call through; only that call's outcome decides what comes next.
  private final class HalfOpen extends State {
    private boolean trial = false;

    String name() {
      return "half-open";
    }

    boolean allow() {
      boolean allowed = !trial;
      trial = true;
      return allowed;
    }

    State success(long nowMs) {
      return trial ? new Closed() : this;
    }

    State failure(long nowMs) {
      return trial ? new Open(nowMs) : this;
    }
  }

  // The manual override: open, with no cool-down, until it's released.
  private final class ForcedOpen extends State {
    String name() {
      return "open";
    }

    State force(boolean on) {
      return on ? this : new Closed();
    }
  }

  private final long threshold;
  private final long coolDownMs;
  private State current = new Closed();
  private long lastMs = 0;

  public CircuitBreaker(long threshold, long coolDownMs) {
    if (threshold < 1 || threshold > MAX_THRESHOLD || coolDownMs < 1 || coolDownMs > MAX_COOL_DOWN_MS)
      throw new IllegalArgumentException("bad threshold or cool-down");
    this.threshold = threshold;
    this.coolDownMs = coolDownMs;
  }

  public boolean allow(long nowMs) {
    return at(nowMs).allow();
  }

  public void success(long nowMs) {
    current = at(nowMs).success(nowMs);
  }

  public void failure(long nowMs) {
    current = at(nowMs).failure(nowMs);
  }

  public String state(long nowMs) {
    return at(nowMs).name();
  }

  // The extension round: the manual override.
  public void forceOpen(boolean on) {
    current = current.force(on);
  }

  private State at(long nowMs) {
    if (nowMs < lastMs) throw new IllegalArgumentException("time went backwards");
    lastMs = nowMs;
    current = current.tick(nowMs);
    return current;
  }
}
