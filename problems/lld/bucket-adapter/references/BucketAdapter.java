import java.util.*;

// Gives the legacy store a bucket-and-key API. The encoding is the adapter's alone: an
// object lives at `<bucket>:<key>`, and a bucket never holds a `:`, so the first one
// splits them.
public class BucketAdapter {
  // The old flat key-value store: no buckets, no folders, just keys.
  private static final class LegacyStore {
    private final TreeMap<String, String> data = new TreeMap<>();

    void put(String key, String value) {
      data.put(key, value);
    }

    String read(String key) {
      return data.get(key);
    }

    List<String> scan(String prefix) {
      List<String> keys = new ArrayList<>();
      for (String key : data.tailMap(prefix, true).keySet()) {
        if (!key.startsWith(prefix)) break;
        keys.add(key);
      }
      return keys;
    }
  }

  private final LegacyStore store = new LegacyStore();

  public void putObject(String bucket, String key, String body) {
    checkBucket(bucket);
    given(key);
    given(body);
    store.put(legacy(bucket, key), body);
  }

  public String objectBody(String bucket, String key) {
    checkBucket(bucket);
    given(key);
    return store.read(legacy(bucket, key));
  }

  public List<String> listObjects(String bucket, String prefix, String delimiter) {
    checkBucket(bucket);
    TreeSet<String> found = new TreeSet<>();
    for (String stored : store.scan(legacy(bucket, prefix))) {
      String key = stored.substring(bucket.length() + 1);
      // S3's common prefixes: what follows the prefix, up to its first delimiter.
      int cut = key.indexOf(delimiter, prefix.length());
      found.add(!delimiter.isEmpty() && cut >= 0 ? key.substring(0, cut + delimiter.length()) : key);
    }
    return new ArrayList<>(found);
  }

  public List<String> legacyKeys() {
    return store.scan("");
  }

  // The extension round: a copy, through the same encoding.
  public boolean copyObject(String bucket, String key, String toBucket, String toKey) {
    checkBucket(bucket);
    given(key);
    checkBucket(toBucket);
    given(toKey);
    String body = store.read(legacy(bucket, key));
    if (body == null) return false;
    store.put(legacy(toBucket, toKey), body);
    return true;
  }

  private static String legacy(String bucket, String key) {
    return bucket + ":" + key;
  }

  private static void checkBucket(String bucket) {
    if (bucket.isEmpty() || bucket.contains(":")) throw new IllegalArgumentException("bad bucket");
  }

  private static void given(String value) {
    if (value.isEmpty()) throw new IllegalArgumentException("empty");
  }
}
