import java.util.*;

public class InvalidationBus {
  // A subscriber: it keeps a local cache and drops a key when it hears it changed.
  private static final class AppNode {
    final Map<String, String> cache = new HashMap<>();
    // The bus version when it went offline, or null while it is online.
    Integer downAt = null;
    final List<String> prefixes = new ArrayList<>(); // none means it hears every key

    boolean hears(String key) {
      return prefixes.isEmpty() || prefixes.stream().anyMatch(key::startsWith);
    }

    void invalidate(String key) {
      cache.remove(key);
    }
  }

  // The publisher: every write is numbered and announced to the nodes online.
  private final Map<String, AppNode> nodes = new HashMap<>();
  private final List<String> log = new ArrayList<>(); // the key of each write, version 1 first

  public InvalidationBus() {}

  public void join(String node) {
    if (node.isEmpty() || nodes.containsKey(node)) throw new IllegalArgumentException("empty or joined");
    nodes.put(node, new AppNode());
  }

  public void cacheLocal(String node, String key, String val) {
    AppNode n = serving(node);
    if (key.isEmpty() || val.isEmpty() || !n.hears(key))
      throw new IllegalArgumentException("empty or outside the keyspace");
    n.cache.put(key, val);
  }

  public long write(String key) {
    if (key.isEmpty()) throw new IllegalArgumentException("empty key");
    log.add(key);
    // A node never caches a key outside its keyspace, so dropping it there is moot.
    for (AppNode n : nodes.values()) if (n.downAt == null) n.invalidate(key);
    return log.size();
  }

  public String cached(String node, String key) {
    AppNode n = serving(node);
    if (key.isEmpty()) throw new IllegalArgumentException("empty key");
    return n.cache.get(key);
  }

  public void offline(String node, boolean down) {
    AppNode n = find(node);
    if (n.downAt == null) {
      if (down) n.downAt = log.size();
      return;
    }
    if (down) return;
    // It can't know which keys changed while it was away, only that some did.
    if (log.subList(n.downAt, log.size()).stream().anyMatch(n::hears)) n.cache.clear();
    n.downAt = null;
  }

  // The extension round: a node hears only the keys under its prefixes.
  public long keyspace(String node, String prefix) {
    AppNode n = find(node);
    if (prefix.isEmpty()) throw new IllegalArgumentException("empty prefix");
    if (!n.prefixes.contains(prefix)) n.prefixes.add(prefix);
    int before = n.cache.size();
    n.cache.keySet().removeIf(key -> !n.hears(key));
    return before - n.cache.size();
  }

  private AppNode find(String node) {
    AppNode n = nodes.get(node);
    if (n == null) throw new IllegalArgumentException("unknown node");
    return n;
  }

  private AppNode serving(String node) {
    AppNode n = find(node);
    if (n.downAt != null) throw new IllegalArgumentException("the node is offline");
    return n;
  }
}
