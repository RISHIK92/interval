import java.util.*;

public class StorageBucket {
  // Fees charged and restores made so far, by reads and (in the extension) moves.
  private static final class Meter {
    long fees = 0;
    long restores = 0;
  }

  private static final class Stored {
    final String data;
    final StorageClass storageClass;
    boolean restored = false;

    Stored(String data, StorageClass storageClass) {
      this.data = data;
      this.storageClass = storageClass;
    }
  }

  // Every class keeps the same promise: read hands back exactly what was stored. They differ
  // only in what that costs, so the bucket never asks which class an object is in.
  private interface StorageClass {
    long rate();

    String read(Stored stored, Meter meter);

    default void leave(Stored stored, Meter meter) {}
  }

  private static final class Standard implements StorageClass {
    public long rate() {
      return 4;
    }

    public String read(Stored stored, Meter meter) {
      return stored.data;
    }
  }

  private static final class InfrequentAccess implements StorageClass {
    public long rate() {
      return 2;
    }

    public String read(Stored stored, Meter meter) {
      meter.fees += stored.data.length();
      return stored.data;
    }
  }

  // Slow to reach, never absent: the first read restores the object, and pays for it,
  // instead of failing or answering null.
  private static final class Archive implements StorageClass {
    public long rate() {
      return 1;
    }

    public String read(Stored stored, Meter meter) {
      leave(stored, meter);
      return stored.data;
    }

    @Override
    public void leave(Stored stored, Meter meter) {
      if (stored.restored) return;
      meter.restores += 1;
      meter.fees += 3L * stored.data.length();
      stored.restored = true;
    }
  }

  private static final Map<String, StorageClass> CLASSES =
      Map.of(
          "standard", new Standard(),
          "infrequent-access", new InfrequentAccess(),
          "archive", new Archive());

  private static void named(String key) {
    if (key.isEmpty()) throw new IllegalArgumentException("empty key");
  }

  private static StorageClass classNamed(String name) {
    StorageClass found = CLASSES.get(name);
    if (found == null) throw new IllegalArgumentException("unknown storage class");
    return found;
  }

  private final Map<String, Stored> objects = new HashMap<>();
  private final Meter meter = new Meter();

  public StorageBucket() {}

  public void store(String key, String data, String storageClass) {
    named(key);
    objects.put(key, new Stored(data, classNamed(storageClass)));
  }

  public String read(String key) {
    named(key);
    Stored stored = objects.get(key);
    return stored == null ? null : stored.storageClass.read(stored, meter);
  }

  public long restores() {
    return meter.restores;
  }

  public long monthlyCost() {
    long keeping = 0;
    for (Stored s : objects.values()) keeping += s.storageClass.rate() * s.data.length();
    return keeping + meter.fees;
  }

  // The extension round: a lifecycle move, which each class leaves in its own way.
  public boolean transition(String key, String storageClass) {
    named(key);
    StorageClass target = classNamed(storageClass);
    Stored stored = objects.get(key);
    if (stored == null || stored.storageClass == target) return false;
    stored.storageClass.leave(stored, meter);
    objects.put(key, new Stored(stored.data, target));
    return true;
  }
}
