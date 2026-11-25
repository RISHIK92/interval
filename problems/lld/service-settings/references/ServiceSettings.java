// Every precondition is checked once, at construction: a ServiceSettings that exists is
// valid, and no later call can make it invalid (its class invariant).
public class ServiceSettings {
  private static final long MIN_WORKERS = 1, MAX_WORKERS = 64;
  private static final long MAX_RETRIES = 10;

  private final long port;
  private long workers;
  private final long timeoutMs;
  private String certPath = null; // TLS is both paths or neither
  private String keyPath = null;

  public ServiceSettings(long port, long workers, long timeoutMs) {
    expect(port >= 1 && port <= 65535, "port is from 1 to 65535");
    expect(validWorkers(workers), "workers is from 1 to 64");
    expect(timeoutMs >= 1 && timeoutMs <= 60_000, "timeoutMs is from 1 to 60000");
    this.port = port;
    this.workers = workers;
    this.timeoutMs = timeoutMs;
  }

  private static void expect(boolean holds, String what) {
    if (!holds) throw new IllegalArgumentException(what);
  }

  private static boolean validWorkers(long n) {
    return n >= MIN_WORKERS && n <= MAX_WORKERS;
  }

  public boolean withWorkers(long n) {
    if (!validWorkers(n)) return false;
    workers = n;
    return true;
  }

  public long budgetMs(long retries) {
    expect(retries >= 0 && retries <= MAX_RETRIES, "retries is from 0 to 10");
    return timeoutMs * (retries + 1);
  }

  public String describe() {
    String base = "port=" + port + " workers=" + workers + " timeoutMs=" + timeoutMs;
    return certPath == null ? base : base + " tls=" + certPath + "," + keyPath;
  }

  // The extension round: TLS is both paths or neither, never half configured.
  public boolean withTls(String certPath, String keyPath) {
    if (certPath.isEmpty() != keyPath.isEmpty()) return false;
    this.certPath = certPath.isEmpty() ? null : certPath;
    this.keyPath = keyPath.isEmpty() ? null : keyPath;
    return true;
  }
}
