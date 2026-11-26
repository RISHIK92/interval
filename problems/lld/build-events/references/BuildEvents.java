import java.util.*;

// The subject: it updates every subscriber that chose the event, in the order they
// subscribed, and knows nothing else about them.
public class BuildEvents {
  private static final Set<String> EVENTS = Set.of("queued", "started", "passed", "failed");

  // An observer: it takes delivery of the events it chose. While paused it keeps them
  // back, in order, until it's resumed.
  private static final class Subscriber {
    final String name;
    final Set<String> events;
    final List<String> inbox = new ArrayList<>();
    List<String> kept = null;

    Subscriber(String name, List<String> events) {
      this.name = name;
      this.events = new HashSet<>(events);
    }

    // Whether the delivery reached the inbox now (not kept back).
    boolean update(String delivery) {
      if (kept != null) kept.add(delivery);
      else inbox.add(delivery);
      return kept == null;
    }
  }

  // LinkedHashMap: delivery goes in the order of subscription, and re-subscribing puts
  // a subscriber at the back.
  private final Map<String, Subscriber> subscribers = new LinkedHashMap<>();

  public void subscribe(String subscriber, List<String> events) {
    given(subscriber);
    if (events.isEmpty() || new HashSet<>(events).size() != events.size())
      throw new IllegalArgumentException("no events, or one listed twice");
    events.forEach(BuildEvents::checkEvent);
    if (subscribers.containsKey(subscriber))
      throw new IllegalStateException("already subscribed");
    subscribers.put(subscriber, new Subscriber(subscriber, events));
  }

  public boolean unsubscribe(String subscriber) {
    given(subscriber);
    return subscribers.remove(subscriber) != null;
  }

  public List<String> publish(String event, String build) {
    checkEvent(event);
    given(build);
    List<String> delivered = new ArrayList<>();
    for (Subscriber subscriber : subscribers.values()) {
      if (!subscriber.events.contains(event)) continue;
      if (subscriber.update(build + " " + event)) delivered.add(subscriber.name);
    }
    return delivered;
  }

  public List<String> inbox(String subscriber) {
    return new ArrayList<>(find(subscriber).inbox);
  }

  // The extension round: holding deliveries back.
  public void pause(String subscriber) {
    Subscriber found = find(subscriber);
    if (found.kept != null) throw new IllegalStateException("already paused");
    found.kept = new ArrayList<>();
  }

  public long resume(String subscriber) {
    Subscriber found = find(subscriber);
    if (found.kept == null) throw new IllegalStateException("not paused");
    found.inbox.addAll(found.kept);
    long delivered = found.kept.size();
    found.kept = null;
    return delivered;
  }

  private static void given(String value) {
    if (value.isEmpty()) throw new IllegalArgumentException("empty");
  }

  private static void checkEvent(String event) {
    if (!EVENTS.contains(event)) throw new IllegalArgumentException("unknown event");
  }

  private Subscriber find(String subscriber) {
    Subscriber found = subscribers.get(subscriber);
    if (found == null) throw new IllegalArgumentException("not subscribed");
    return found;
  }
}
