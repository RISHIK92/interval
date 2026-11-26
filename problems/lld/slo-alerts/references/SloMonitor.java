import java.util.*;

public class SloMonitor {
  private static final long PERMILLE = 1000;
  private static final long PERCENT = 100;

  // An observer of one service. It speaks only when the service's burn crosses its
  // threshold, in either direction, so it never repeats itself.
  private static final class Watcher {
    final String subscriber;
    long threshold;
    boolean alerting = false;

    Watcher(String subscriber, long threshold) {
      this.subscriber = subscriber;
      this.threshold = threshold;
    }

    String update(long burned) {
      boolean burning = burned >= threshold;
      if (burning == alerting) return null;
      alerting = burning;
      return subscriber + (burning ? " burning" : " recovered");
    }
  }

  // The subject: its request counts, and the watchers it tells after each change.
  private static final class Service {
    long good = 0;
    long bad = 0;
    final Map<String, Watcher> watchers = new LinkedHashMap<>();

    long burned(long allowed) {
      long total = good + bad;
      if (total == 0) return 0;
      return bad * PERMILLE * PERCENT / (total * allowed);
    }
  }

  // The error budget: how many requests in a thousand may fail.
  private final long allowed;
  private final Map<String, Service> services = new HashMap<>();

  public SloMonitor(long objectivePermille) {
    if (objectivePermille <= 0 || objectivePermille >= PERMILLE)
      throw new IllegalArgumentException("an objective from 1 to 999 permille");
    allowed = PERMILLE - objectivePermille;
  }

  public void watch(String subscriber, String service, long burnPercent) {
    if (subscriber.isEmpty() || service.isEmpty() || burnPercent <= 0 || burnPercent > PERCENT)
      throw new IllegalArgumentException("an empty name or a threshold outside 1 to 100");
    Map<String, Watcher> watchers = services.computeIfAbsent(service, s -> new Service()).watchers;
    Watcher known = watchers.get(subscriber);
    if (known != null) known.threshold = burnPercent;
    else watchers.put(subscriber, new Watcher(subscriber, burnPercent));
  }

  public List<String> observe(String service, long good, long bad) {
    if (service.isEmpty() || good < 0 || bad < 0)
      throw new IllegalArgumentException("an empty service or a negative count");
    Service subject = services.computeIfAbsent(service, s -> new Service());
    subject.good += good;
    subject.bad += bad;
    long burned = subject.burned(allowed);
    List<String> told = new ArrayList<>();
    for (Watcher watcher : subject.watchers.values()) {
      String message = watcher.update(burned);
      if (message != null) told.add(message);
    }
    return told;
  }

  public long budgetLeft(String service) {
    if (service.isEmpty()) throw new IllegalArgumentException("an empty service");
    Service found = services.get(service);
    return PERCENT - (found == null ? 0 : found.burned(allowed));
  }

  // The extension round: a watcher leaves, and coming back starts afresh at the end.
  public boolean unwatch(String subscriber, String service) {
    if (subscriber.isEmpty() || service.isEmpty()) throw new IllegalArgumentException("an empty name");
    Service found = services.get(service);
    return found != null && found.watchers.remove(subscriber) != null;
  }
}
