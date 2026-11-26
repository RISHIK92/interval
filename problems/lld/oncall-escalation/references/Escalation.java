import java.util.*;

public class Escalation {
  // One link in the chain: its person is paged in turn, and when they don't acknowledge
  // in time the page moves on to the next link, if there is one.
  private static final class Level {
    final String person;
    final Level after;

    Level(String person, Level after) {
      this.person = person;
      this.after = after;
    }
  }

  private static final class Incident {
    Level level;
    String holder;
    long since;
    boolean acked = false;

    Incident(Level level, String holder, long since) {
      this.level = level;
      this.holder = holder;
      this.since = since;
    }
  }

  private final Level first;
  private final Set<String> people;
  private final long timeout;
  private final TreeMap<String, Incident> incidents = new TreeMap<>();
  private final Map<String, String> covers = new HashMap<>();
  private long now = 0;

  public Escalation(List<String> levels, long ackTimeoutMs) {
    if (levels.isEmpty()
        || levels.contains("")
        || new HashSet<>(levels).size() != levels.size()
        || ackTimeoutMs < 1) throw new IllegalArgumentException("bad levels or timeout");
    Level link = null;
    for (int i = levels.size() - 1; i >= 0; i--) link = new Level(levels.get(i), link);
    first = link;
    people = new HashSet<>(levels);
    timeout = ackTimeoutMs;
  }

  private void clock(long nowMs) {
    if (nowMs < now) throw new IllegalArgumentException("time went backwards");
    now = nowMs;
  }

  private String paged(Level level) {
    return covers.getOrDefault(level.person, level.person);
  }

  public String page(String incident, long nowMs) {
    if (incident.isEmpty() || incidents.containsKey(incident))
      throw new IllegalArgumentException("an empty or known incident");
    clock(nowMs);
    String holder = paged(first);
    incidents.put(incident, new Incident(first, holder, nowMs));
    return holder;
  }

  public List<String> tick(long nowMs) {
    clock(nowMs);
    List<String> moved = new ArrayList<>();
    for (Map.Entry<String, Incident> e : incidents.entrySet()) {
      Incident incident = e.getValue();
      Level after = incident.level.after;
      if (incident.acked || after == null || nowMs - incident.since < timeout) continue;
      incident.level = after;
      incident.holder = paged(after);
      incident.since = nowMs;
      moved.add(e.getKey() + " -> " + incident.holder);
    }
    return moved;
  }

  public boolean ack(String incident, String person, long nowMs) {
    if (incident.isEmpty() || person.isEmpty()) throw new IllegalArgumentException("an empty name");
    clock(nowMs);
    Incident found = incidents.get(incident);
    if (found == null || found.acked || !found.holder.equals(person)) return false;
    found.acked = true;
    return true;
  }

  public String holder(String incident) {
    if (incident.isEmpty()) throw new IllegalArgumentException("an empty incident");
    Incident found = incidents.get(incident);
    return found == null ? null : found.holder;
  }

  // The extension round: holiday cover, applied whenever someone is paged from now on.
  public void cover(String person, String substitute) {
    if (!people.contains(person) || substitute.isEmpty())
      throw new IllegalArgumentException("not on call, or an empty substitute");
    if (substitute.equals(person)) covers.remove(person);
    else covers.put(person, substitute);
  }
}
