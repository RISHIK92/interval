import java.util.*;

// Caps, schedules and totals are the same for every kind; only the growth is swapped.
public class BackoffSchedule {
  private static final long MAX_ATTEMPTS = 1000;
  private static final long MAX_CAP_MS = 1_000_000_000L;

  // The one thing that varies between schedules: the delay before an attempt, at most
  // `cap`. Growth stops at the cap, so no kind ever overflows.
  private interface Growth {
    long delay(long attempt, long base, long cap);
  }

  private static final Growth FIXED = (attempt, base, cap) -> base;
  private static final Growth LINEAR = (attempt, base, cap) -> Math.min(base * attempt, cap);
  private static final Growth EXPONENTIAL =
      (attempt, base, cap) -> {
        long d = base;
        for (long a = 1; a < attempt && d < cap; a++) d *= 2;
        return Math.min(d, cap);
      };
  private static final Growth FIBONACCI =
      (attempt, base, cap) -> {
        long previous = 0, current = base;
        for (long a = 1; a < attempt && current < cap; a++) {
          long next = previous + current;
          previous = current;
          current = next;
        }
        return Math.min(current, cap);
      };

  private static final Map<String, Growth> KINDS =
      Map.of("fixed", FIXED, "linear", LINEAR, "exponential", EXPONENTIAL);

  private Growth growth;
  private final long base;
  private final long cap;

  public BackoffSchedule(String kind, long baseMs, long capMs) {
    Growth chosen = growthOf(kind);
    if (baseMs < 1 || capMs < baseMs || capMs > MAX_CAP_MS)
      throw new IllegalArgumentException("1 <= baseMs <= capMs <= 10^9");
    growth = chosen;
    base = baseMs;
    cap = capMs;
  }

  private static Growth growthOf(String kind) {
    Growth found = KINDS.get(kind);
    if (found == null) throw new IllegalArgumentException("unknown kind");
    return found;
  }

  private static void count(long n, long low) {
    if (n < low || n > MAX_ATTEMPTS) throw new IllegalArgumentException("attempts out of range");
  }

  public long delay(long attempt) {
    count(attempt, 1);
    return growth.delay(attempt, base, cap);
  }

  public List<Long> schedule(long attempts) {
    count(attempts, 0);
    List<Long> out = new ArrayList<>();
    for (long a = 1; a <= attempts; a++) out.add(delay(a));
    return out;
  }

  public long totalMs(long attempts) {
    long sum = 0;
    for (long d : schedule(attempts)) sum += d;
    return sum;
  }

  public void switchTo(String kind) {
    growth = growthOf(kind);
  }

  // The extension round: one more growth, and nothing else changes.
  public void fibonacci() {
    growth = FIBONACCI;
  }
}
