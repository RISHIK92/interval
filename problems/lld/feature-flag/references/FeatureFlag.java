import java.util.*;

public class FeatureFlag {
  private final String name;
  private long percent;
  private boolean killed = false;
  private final Set<Long> allowed = new HashSet<>();

  public FeatureFlag(String name, long rolloutPercent) {
    if (name.isEmpty()) throw new IllegalArgumentException("a flag needs a name");
    this.name = name;
    this.percent = checkedPercent(rolloutPercent);
  }

  private static long checkedPercent(long percent) {
    if (percent < 0 || percent > 100) throw new IllegalArgumentException("percent must be within 0-100");
    return percent;
  }

  private static long checkedBucket(long bucket) {
    if (bucket < 0 || bucket > 99) throw new IllegalArgumentException("bucket must be within 0-99");
    return bucket;
  }

  public boolean enabledFor(long userBucket) {
    long bucket = checkedBucket(userBucket);
    if (killed) return false;
    return allowed.contains(bucket) || bucket < percent;
  }

  public void setRollout(long percent) {
    this.percent = checkedPercent(percent);
  }

  public void kill() {
    killed = true;
  }

  public void revive() {
    killed = false;
  }

  // The extension round.
  public void allow(long userBucket) {
    allowed.add(checkedBucket(userBucket));
  }
}
