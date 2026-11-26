import java.util.*;

public class ShardRouter {
  private static final long MOST_SHARDS = 1000;
  private static final long MODULUS = 1_000_000_007L;

  // How a key finds its shard; null when this strategy has no shard for it.
  private interface Strategy {
    Long shard(String key, long shards);
  }

  private static final class HashModulo implements Strategy {
    public Long shard(String key, long shards) {
      long h = 0;
      for (int i = 0; i < key.length(); i++) h = (h * 31 + key.charAt(i)) % MODULUS;
      return h % shards;
    }
  }

  private static final class KeyRange implements Strategy {
    public Long shard(String key, long shards) {
      // Printable ASCII split into equal ranges by the first character.
      return (key.charAt(0) - 32) * shards / 95;
    }
  }

  private record Directory(Map<String, Long> entries) implements Strategy {
    public Long shard(String key, long shards) {
      return entries.get(key);
    }
  }

  private long shards;
  private final Map<String, Long> directory = new HashMap<>();
  private final Map<String, Strategy> strategies =
      Map.of("hash", new HashModulo(), "range", new KeyRange(), "directory", new Directory(directory));
  private Strategy strategy;
  private final Set<String> tracked = new HashSet<>();

  public ShardRouter(long shards, String strategy) {
    checkCount(shards);
    this.shards = shards;
    this.strategy = pick(strategy);
  }

  public long route(String key) {
    Long shard = strategy.shard(checkKey(key), shards);
    if (shard == null) throw new IllegalArgumentException("no directory entry");
    return shard;
  }

  public void track(String key) {
    tracked.add(checkKey(key));
  }

  public void assignDirectory(String key, long shard) {
    checkKey(key);
    if (shard < 0 || shard >= shards) throw new IllegalArgumentException("no such shard");
    directory.put(key, shard);
  }

  public long rebalance(long shards) {
    checkCount(shards);
    Map<String, Long> before = placement();
    this.shards = shards;
    directory.replaceAll((key, at) -> at % shards);
    return moved(before);
  }

  // The extension round: switching strategy, reporting what moves.
  public long useStrategy(String strategy) {
    Strategy chosen = pick(strategy);
    Map<String, Long> before = placement();
    this.strategy = chosen;
    return moved(before);
  }

  private Strategy pick(String name) {
    Strategy found = strategies.get(name);
    if (found == null) throw new IllegalArgumentException("unknown strategy");
    return found;
  }

  private Map<String, Long> placement() {
    Map<String, Long> out = new HashMap<>();
    for (String key : tracked) out.put(key, strategy.shard(key, shards));
    return out;
  }

  private long moved(Map<String, Long> before) {
    Map<String, Long> after = placement();
    return tracked.stream().filter(key -> !Objects.equals(before.get(key), after.get(key))).count();
  }

  private static void checkCount(long shards) {
    if (shards < 1 || shards > MOST_SHARDS) throw new IllegalArgumentException("shards out of range");
  }

  private static String checkKey(String key) {
    if (key.isEmpty()) throw new IllegalArgumentException("empty key");
    return key;
  }
}
