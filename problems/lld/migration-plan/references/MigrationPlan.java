import java.util.*;

// Invariant: the applied migrations are exactly the lowest `applied` versions, so the
// current version is the last of them and everything above it is pending.
public class MigrationPlan {
  private static final long MAX_VERSION = 1_000_000_000L;

  // A broken precondition fails the call before anything changes.
  private static void precondition(boolean condition, String why) {
    if (!condition) throw new IllegalStateException(why);
  }

  private final TreeMap<Long, String> names = new TreeMap<>();
  private final List<Long> versions = new ArrayList<>();
  private int applied = 0;
  private final Set<Long> locked = new HashSet<>();

  public MigrationPlan() {}

  // How many of the sorted versions are at or below `version`.
  private int countUpTo(long version) {
    return names.headMap(version, true).size();
  }

  public void add(long version, String name) {
    precondition(version >= 1 && version <= MAX_VERSION, "versions are within 1 and 10^9");
    precondition(!name.isEmpty(), "a migration has a name");
    precondition(!names.containsKey(version), "that version is already planned");
    // It must land above every applied migration, or it could never be applied.
    precondition(version > current(), "that version is below the current one");
    versions.add(countUpTo(version), version);
    names.put(version, name);
  }

  public List<String> applyUpTo(long version) {
    precondition(names.containsKey(version), "unknown version");
    precondition(version >= current(), "applying never goes down");
    int start = applied;
    applied = countUpTo(version);
    List<String> out = new ArrayList<>();
    for (long v : versions.subList(start, applied)) out.add(names.get(v));
    return out;
  }

  public List<String> rollback(long steps) {
    precondition(steps >= 1 && steps <= applied, "steps are within 1 and the applied count");
    List<Long> undone = new ArrayList<>(versions.subList(applied - (int) steps, applied));
    Collections.reverse(undone);
    for (long v : undone) precondition(!locked.contains(v), "an irreversible migration is in the way");
    applied -= (int) steps;
    List<String> out = new ArrayList<>();
    for (long v : undone) out.add(names.get(v));
    return out;
  }

  public long current() {
    return applied > 0 ? versions.get(applied - 1) : 0;
  }

  public List<Long> pending() {
    return new ArrayList<>(versions.subList(applied, versions.size()));
  }

  // The extension round: one more precondition on rollback.
  public void irreversible(long version) {
    precondition(names.containsKey(version), "unknown version");
    locked.add(version);
  }
}
