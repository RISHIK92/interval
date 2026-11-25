import java.util.*;

public class IncidentRoom {
  private static final long MAX_MS = 1_000_000_000_000_000L;

  // Owns its timeline: nothing outside the incident appends to it.
  private static final class Incident {
    String commander;
    final Set<String> responders = new HashSet<>();
    final long declaredAt;
    Long resolvedAt = null;
    long lastMs;
    final List<String> lines = new ArrayList<>();

    Incident(String commander, long nowMs) {
      this.commander = commander;
      responders.add(commander);
      declaredAt = nowMs;
      write(nowMs, "declared by " + commander);
    }

    void write(long nowMs, String text) {
      lastMs = nowMs;
      lines.add(nowMs + " " + text);
    }
  }

  private final Map<String, Incident> incidents = new HashMap<>();

  public IncidentRoom() {}

  private static void named(String... names) {
    for (String n : names) if (n.isEmpty()) throw new IllegalArgumentException("ids, names and notes are not empty");
  }

  private static void timed(long nowMs) {
    if (nowMs < 0 || nowMs > MAX_MS) throw new IllegalArgumentException("nowMs must be within 0 and 10^15");
  }

  private Incident find(String id) {
    named(id);
    Incident incident = incidents.get(id);
    if (incident == null) throw new IllegalArgumentException("unknown incident");
    return incident;
  }

  private Incident at(String id, long nowMs) {
    timed(nowMs);
    Incident incident = find(id);
    if (nowMs < incident.lastMs) throw new IllegalArgumentException("time went backwards");
    return incident;
  }

  public void declareIncident(String id, String commander, long nowMs) {
    named(id, commander);
    timed(nowMs);
    if (incidents.containsKey(id)) throw new IllegalArgumentException("incident already declared");
    incidents.put(id, new Incident(commander, nowMs));
  }

  public boolean joinIncident(String id, String responder, long nowMs) {
    named(responder);
    Incident incident = at(id, nowMs);
    if (!incident.responders.add(responder)) return false;
    incident.write(nowMs, responder + " joined");
    return true;
  }

  public boolean note(String id, String author, String text, long nowMs) {
    named(author, text);
    Incident incident = at(id, nowMs);
    if (!incident.responders.contains(author) || incident.resolvedAt != null) return false;
    incident.write(nowMs, author + ": " + text);
    return true;
  }

  public boolean handOff(String id, String to, long nowMs) {
    named(to);
    Incident incident = at(id, nowMs);
    if (!incident.responders.contains(to) || to.equals(incident.commander)) return false;
    incident.write(nowMs, incident.commander + " handed off to " + to);
    incident.commander = to;
    return true;
  }

  public List<String> timeline(String id) {
    return new ArrayList<>(find(id).lines);
  }

  // The extension round: resolving closes the incident to notes.
  public boolean resolve(String id, long nowMs) {
    Incident incident = at(id, nowMs);
    if (incident.resolvedAt != null) return false;
    incident.resolvedAt = nowMs;
    incident.write(nowMs, "resolved");
    return true;
  }

  public long durationMs(String id) {
    Incident incident = find(id);
    if (incident.resolvedAt == null) throw new IllegalArgumentException("not resolved yet");
    return incident.resolvedAt - incident.declaredAt;
  }
}
