import java.util.*;

// Keeps preferences and decides delivery; sending is someone else's job.
public class NotificationPrefs {
  private static final List<String> CHANNELS = List.of("email", "push", "sms"); // sorted

  // When a user doesn't want to be disturbed; knows nothing about channels. The same
  // start and end is an empty window.
  private record QuietHours(long start, long end) {
    boolean contains(long hour) {
      if (start <= end) return hour >= start && hour < end;
      return hour >= start || hour < end; // wraps past midnight
    }
  }

  // What one user chose. It answers questions about itself and never routes.
  private static final class Preferences {
    private final Set<String> optedOut = new HashSet<>();
    private QuietHours quiet = null;
    private final Set<String> digested = new HashSet<>();
    private final Map<String, Long> held = new HashMap<>(); // channel -> messages held for the digest

    void optOut(String channel) {
      optedOut.add(channel);
      held.remove(channel);
    }

    void setQuiet(QuietHours quiet) {
      this.quiet = quiet;
    }

    boolean receives(String channel) {
      return !optedOut.contains(channel);
    }

    boolean isQuiet(long hour) {
      return quiet != null && quiet.contains(hour);
    }

    void useDigest(String channel) {
      digested.add(channel);
    }

    // Holds a message for the digest when the channel uses one.
    boolean holds(String channel) {
      boolean holding = digested.contains(channel);
      if (holding) held.merge(channel, 1L, Long::sum);
      return holding;
    }

    long flush() {
      long total = 0;
      for (long n : held.values()) total += n;
      held.clear();
      return total;
    }
  }

  private final Map<String, Preferences> users = new HashMap<>();

  public NotificationPrefs() {}

  private static void check(String user) {
    if (user.isEmpty()) throw new IllegalArgumentException("a user is not empty");
  }

  private static void check(String user, String channel) {
    check(user);
    if (!CHANNELS.contains(channel)) throw new IllegalArgumentException("unknown channel");
  }

  private static void checkHour(long hour) {
    if (hour < 0 || hour > 23) throw new IllegalArgumentException("an hour is from 0 to 23");
  }

  private Preferences prefs(String user) {
    return users.computeIfAbsent(user, u -> new Preferences());
  }

  public void optOut(String user, String channel) {
    check(user, channel);
    prefs(user).optOut(channel);
  }

  public void quietHours(String user, long startHour, long endHour) {
    check(user);
    checkHour(startHour);
    checkHour(endHour);
    prefs(user).setQuiet(new QuietHours(startHour, endHour));
  }

  public boolean route(String user, String channel, long hour, boolean urgent) {
    check(user, channel);
    checkHour(hour);
    Preferences prefs = users.get(user);
    if (prefs == null) return true;
    if (!prefs.receives(channel)) return false;
    if (urgent) return true;
    return !prefs.holds(channel) && !prefs.isQuiet(hour);
  }

  public List<String> channels(String user) {
    check(user);
    Preferences prefs = users.get(user);
    List<String> out = new ArrayList<>();
    for (String c : CHANNELS) if (prefs == null || prefs.receives(c)) out.add(c);
    return out;
  }

  // The extension round: non-urgent messages on a digest channel wait for the digest.
  public void digest(String user, String channel) {
    check(user, channel);
    prefs(user).useDigest(channel);
  }

  public long flushDigest(String user) {
    check(user);
    Preferences prefs = users.get(user);
    return prefs == null ? 0 : prefs.flush();
  }
}
