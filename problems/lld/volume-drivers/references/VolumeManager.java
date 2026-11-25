import java.util.*;

public class VolumeManager {
  private static final long MAX_SIZE_GB = 65_536;
  private static final Set<String> OPS = Set.of("snapshot", "resize", "encrypt");

  private static final class Volume {
    final String name;
    long size;
    // Each snapshot id and the size it recorded, oldest first.
    final LinkedHashMap<String, Long> snapshots = new LinkedHashMap<>();

    Volume(String name, long size) {
      this.name = name;
      this.size = size;
    }
  }

  // Each operation is its own narrow capability. A driver holds only the ones it has, so
  // the manager can't call an operation a driver lacks: it finds no capability and fails.
  private static final class Snapshots {
    String take(Volume volume) {
      String snapshot = volume.name + "@" + (volume.snapshots.size() + 1);
      volume.snapshots.put(snapshot, volume.size);
      return snapshot;
    }

    boolean restore(Volume volume, String snapshot) {
      Long size = volume.snapshots.get(snapshot);
      if (size == null) return false;
      volume.size = size;
      return true;
    }
  }

  private static final class Resizing {
    boolean grow(Volume volume, long size) {
      if (size <= volume.size) return false;
      volume.size = size;
      return true;
    }
  }

  // "encrypt" is a known operation, but no call here needs it, so it has no capability yet.
  private static final class Driver {
    final Optional<Snapshots> snapshots;
    final Optional<Resizing> resizing;

    Driver(List<String> ops) {
      if (new HashSet<>(ops).size() != ops.size() || !OPS.containsAll(ops))
        throw new IllegalArgumentException("ops are distinct, from snapshot, resize and encrypt");
      snapshots = ops.contains("snapshot") ? Optional.of(new Snapshots()) : Optional.empty();
      resizing = ops.contains("resize") ? Optional.of(new Resizing()) : Optional.empty();
    }
  }

  private record Entry(Volume volume, Driver driver) {}

  private static String named(String text) {
    if (text.isEmpty()) throw new IllegalArgumentException("an empty name");
    return text;
  }

  private static long sized(long sizeGb) {
    if (sizeGb < 1 || sizeGb > MAX_SIZE_GB) throw new IllegalArgumentException("a size is 1 to 65536 GB");
    return sizeGb;
  }

  private final Map<String, Driver> drivers = new HashMap<>();
  private final Map<String, Entry> volumes = new HashMap<>();

  public VolumeManager() {}

  public void driver(String name, List<String> ops) {
    if (drivers.containsKey(named(name))) throw new IllegalArgumentException("a driver is registered once");
    drivers.put(name, new Driver(ops));
  }

  public boolean create(String volume, String driver, long sizeGb) {
    named(volume);
    Driver found = drivers.get(driver);
    if (found == null) throw new NoSuchElementException("an unknown driver");
    long size = sized(sizeGb);
    if (volumes.containsKey(volume)) return false;
    volumes.put(volume, new Entry(new Volume(volume, size), found));
    return true;
  }

  public String snapshot(String volume) {
    Snapshotting found = snapshotting(volume);
    return found.snapshots().take(found.volume());
  }

  public boolean resize(String volume, long sizeGb) {
    Entry entry = find(volume);
    Resizing resizing =
        entry.driver().resizing.orElseThrow(() -> new UnsupportedOperationException("the driver can't resize"));
    return resizing.grow(entry.volume(), sized(sizeGb));
  }

  public List<String> snapshots(String volume) {
    return new ArrayList<>(snapshotting(volume).volume().snapshots.keySet());
  }

  // The extension round.
  public boolean restore(String volume, String snapshot) {
    Snapshotting found = snapshotting(volume);
    return found.snapshots().restore(found.volume(), named(snapshot));
  }

  private Entry find(String volume) {
    Entry entry = volumes.get(volume);
    if (entry == null) throw new NoSuchElementException("an unknown volume");
    return entry;
  }

  private record Snapshotting(Volume volume, Snapshots snapshots) {}

  private Snapshotting snapshotting(String volume) {
    Entry entry = find(volume);
    Snapshots snapshots =
        entry.driver().snapshots.orElseThrow(() -> new UnsupportedOperationException("the driver can't snapshot"));
    return new Snapshotting(entry.volume(), snapshots);
  }
}
