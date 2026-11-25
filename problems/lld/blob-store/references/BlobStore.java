import java.util.*;
import java.util.function.Supplier;

public class BlobStore {
  // What the store needs from where blobs are kept. Callers only see BlobStore, so which
  // backend is behind it never shows in their code.
  private interface Backend {
    long put(String key, String data);

    String latest(String key);

    String version(String key, long version);

    boolean remove(String key);

    Set<String> keys();
  }

  // Keeps only the latest blob of each key, and counts the puts to number it.
  private static final class Plain implements Backend {
    private record Blob(long number, String data) {}

    private final Map<String, Blob> blobs = new HashMap<>();

    public long put(String key, String data) {
      Blob found = blobs.get(key);
      long number = found == null ? 1 : found.number() + 1;
      blobs.put(key, new Blob(number, data));
      return number;
    }

    public String latest(String key) {
      Blob found = blobs.get(key);
      return found == null ? null : found.data();
    }

    public String version(String key, long version) {
      Blob found = blobs.get(key);
      return found != null && found.number() == version ? found.data() : null;
    }

    public boolean remove(String key) {
      return blobs.remove(key) != null;
    }

    public Set<String> keys() {
      return blobs.keySet();
    }
  }

  // Keeps every blob each key has had, oldest first.
  private static final class Versioned implements Backend {
    private final Map<String, List<String>> history = new HashMap<>();

    public long put(String key, String data) {
      List<String> found = history.computeIfAbsent(key, k -> new ArrayList<>());
      found.add(data);
      return found.size();
    }

    public String latest(String key) {
      List<String> found = history.get(key);
      return found == null ? null : found.get(found.size() - 1);
    }

    public String version(String key, long version) {
      List<String> found = history.getOrDefault(key, List.of());
      return version <= found.size() ? found.get((int) version - 1) : null;
    }

    public boolean remove(String key) {
      return history.remove(key) != null;
    }

    public Set<String> keys() {
      return history.keySet();
    }
  }

  private static final Map<String, Supplier<Backend>> BACKENDS =
      Map.of("plain", Plain::new, "versioned", Versioned::new);

  private static Backend open(String kind) {
    Supplier<Backend> made = BACKENDS.get(kind);
    if (made == null) throw new IllegalArgumentException("unknown backend");
    return made.get();
  }

  private static void named(String key) {
    if (key.isEmpty()) throw new IllegalArgumentException("keys are not empty");
  }

  private String kind;
  private Backend backend;

  public BlobStore(String backend) {
    this.backend = open(backend);
    this.kind = backend;
  }

  public long putBlob(String key, String data) {
    named(key);
    return backend.put(key, data);
  }

  public String fetch(String key) {
    named(key);
    return backend.latest(key);
  }

  public boolean remove(String key) {
    named(key);
    return backend.remove(key);
  }

  public List<String> listKeys(String prefix) {
    List<String> out = new ArrayList<>();
    for (String k : backend.keys()) if (k.startsWith(prefix)) out.add(k);
    Collections.sort(out);
    return out;
  }

  public long migrate(String backend) {
    if (backend.equals(kind)) throw new IllegalArgumentException("already on that backend");
    Backend target = open(backend);
    for (String key : this.backend.keys()) target.put(key, this.backend.latest(key));
    long moved = this.backend.keys().size();
    this.kind = backend;
    this.backend = target;
    return moved;
  }

  // The extension round: one more question for every backend, answered its own way.
  public String fetchVersion(String key, long version) {
    named(key);
    if (version < 1) throw new IllegalArgumentException("versions start at 1");
    return backend.version(key, version);
  }
}
