import java.util.*;

public class InfraState {
  private static TreeMap<String, Map<String, String>> copy(Map<String, Map<String, String>> from) {
    TreeMap<String, Map<String, String>> out = new TreeMap<>();
    from.forEach((name, attrs) -> out.put(name, new HashMap<>(attrs)));
    return out;
  }

  // The memento: a frozen copy of the state that only InfraState reads back.
  private static final class Snapshot {
    final String label;
    private final Map<String, Map<String, String>> saved;

    Snapshot(String label, Map<String, Map<String, String>> resources) {
      this.label = label;
      this.saved = copy(resources);
    }

    TreeMap<String, Map<String, String>> resources() {
      return copy(saved);
    }
  }

  private TreeMap<String, Map<String, String>> current = new TreeMap<>();
  // The caretaker's side: snapshots by id, known here only by their labels.
  private final TreeMap<Long, Snapshot> snapshots = new TreeMap<>();
  private long lastId = 0;

  public InfraState() {}

  public void apply(String resource, Map<String, String> attrs) {
    if (resource.isEmpty()
        || attrs.entrySet().stream().anyMatch(e -> e.getKey().isEmpty() || e.getValue().isEmpty()))
      throw new IllegalArgumentException("empty name or value");
    current.put(resource, new HashMap<>(attrs));
  }

  public boolean destroy(String resource) {
    if (resource.isEmpty()) throw new IllegalArgumentException("empty resource");
    return current.remove(resource) != null;
  }

  public long snapshot(String label) {
    if (label.isEmpty()) throw new IllegalArgumentException("empty label");
    snapshots.values().removeIf(s -> s.label.equals(label));
    lastId += 1;
    snapshots.put(lastId, new Snapshot(label, current));
    return lastId;
  }

  public boolean restore(long snapshotId) {
    Snapshot snap = snapshots.get(snapshotId);
    if (snap == null) return false;
    current = snap.resources();
    return true;
  }

  public List<String> diffSince(long snapshotId) {
    Snapshot snap = snapshots.get(snapshotId);
    if (snap == null) throw new IllegalArgumentException("unknown snapshot");
    TreeMap<String, Map<String, String>> then = snap.resources();
    TreeSet<String> names = new TreeSet<>(then.keySet());
    names.addAll(current.keySet());
    List<String> out = new ArrayList<>();
    for (String name : names) {
      Map<String, String> before = then.get(name), now = current.get(name);
      if (before == null) out.add("+ " + name);
      else if (now == null) out.add("- " + name);
      else {
        TreeSet<String> keys = new TreeSet<>(before.keySet());
        keys.addAll(now.keySet());
        keys.removeIf(k -> Objects.equals(before.get(k), now.get(k)));
        if (!keys.isEmpty()) out.add("~ " + name + ": " + String.join(",", keys));
      }
    }
    return out;
  }

  // The extension round: keeping only the newest snapshots.
  public long prune(long keep) {
    if (keep < 0) throw new IllegalArgumentException("negative keep");
    long dropped = Math.max(snapshots.size() - keep, 0);
    for (long i = 0; i < dropped; i++) snapshots.pollFirstEntry();
    return dropped;
  }
}
