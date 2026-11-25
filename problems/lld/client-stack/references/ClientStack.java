import java.util.*;

public class ClientStack {
  private static final long FAILURE = 500; // a status of at least this is a failure
  private static final long BACKOFF_MS = 100; // the wait before the first retry; doubles after
  private static final long OPEN_MS = 1000; // how long a breaker stays open

  private record Answer(long status, long took) {}

  // Every layer, and the transport at the bottom, has the same call: a request for a path
  // that starts at time t returns its status and how long it took. A layer wraps the one
  // below it and never knows what that is.
  private interface Layer {
    Answer call(String path, long t);
  }

  // One path's scripted answers: in order, then the last one again and again.
  private static final class Script {
    private final List<Answer> answers = new ArrayList<>();
    private int served = 0;

    Script(List<Long> statuses, List<Long> latencies) {
      for (int i = 0; i < statuses.size(); i++) answers.add(new Answer(statuses.get(i), latencies.get(i)));
    }

    Answer next() {
      Answer answer = answers.get(Math.min(served, answers.size() - 1));
      served++;
      return answer;
    }
  }

  private static final class Transport implements Layer {
    final Map<String, Script> scripts = new HashMap<>();
    long calls = 0;

    public Answer call(String path, long t) {
      calls++;
      return scripts.get(path).next();
    }
  }

  private static final class Retry implements Layer {
    private final Layer inner;
    private final long retries;

    Retry(Layer inner, long retries) {
      this.inner = inner;
      this.retries = retries;
    }

    public Answer call(String path, long t) {
      long spent = 0;
      Answer answer = null;
      for (long attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) spent += BACKOFF_MS << (attempt - 1);
        answer = inner.call(path, t + spent);
        spent += answer.took();
        if (answer.status() < FAILURE) break;
      }
      return new Answer(answer.status(), spent);
    }
  }

  private static final class Cache implements Layer {
    private final Layer inner;
    private final long ttl;
    private final Map<String, Long> stored = new HashMap<>(); // path -> when its 200 arrived

    Cache(Layer inner, long ttl) {
      this.inner = inner;
      this.ttl = ttl;
    }

    public Answer call(String path, long t) {
      Long at = stored.get(path);
      if (at != null && at <= t && t < at + ttl) return new Answer(200, 0);
      Answer answer = inner.call(path, t);
      if (answer.status() == 200) stored.put(path, t + answer.took());
      return answer;
    }
  }

  private static final class Breaker implements Layer {
    private final Layer inner;
    private final long threshold;
    private long failures = 0;
    private Long opened = null;

    Breaker(Layer inner, long threshold) {
      this.inner = inner;
      this.threshold = threshold;
    }

    public Answer call(String path, long t) {
      if (opened != null && opened <= t && t < opened + OPEN_MS) return new Answer(503, 0);
      Answer answer = inner.call(path, t);
      if (answer.status() < FAILURE) {
        failures = 0;
        return answer;
      }
      failures++;
      if (failures >= threshold) {
        opened = t + answer.took();
        // It stays at the threshold, so after the cooldown one more failure reopens it
        // straight away. A success only resets the count; an open window runs out on its own.
        failures = threshold;
      }
      return answer;
    }
  }

  private static final class Hedge implements Layer {
    private final Layer inner;
    private final long after;

    Hedge(Layer inner, long after) {
      this.inner = inner;
      this.after = after;
    }

    public Answer call(String path, long t) {
      Answer first = inner.call(path, t);
      if (first.took() <= after) return first;
      Answer second = inner.call(path, t + after);
      if (after + second.took() < first.took()) return new Answer(second.status(), after + second.took());
      return first;
    }
  }

  // A decorator stack over a scripted transport: each wrap puts a layer outside the ones
  // already there, so the order of the wraps decides what each layer sees.
  private final Transport transport = new Transport();
  private Layer top = transport;
  private long elapsed = 0;

  public void script(String path, List<Long> statuses, List<Long> latenciesMs) {
    if (path.isEmpty() || statuses.isEmpty() || statuses.size() != latenciesMs.size())
      throw new IllegalArgumentException("a path and one latency per status");
    for (long s : statuses) if (s < 100 || s > 599) throw new IllegalArgumentException("not an HTTP status");
    for (long l : latenciesMs) if (l < 0) throw new IllegalArgumentException("a negative latency");
    transport.scripts.put(path, new Script(statuses, latenciesMs));
  }

  public void wrap(String layer, long param) {
    if (param < 1 || (layer.equals("retry") && param > 5)) throw new IllegalArgumentException("out of range");
    switch (layer) {
      case "retry" -> top = new Retry(top, param);
      case "cache" -> top = new Cache(top, param);
      case "breaker" -> top = new Breaker(top, param);
      default -> throw new IllegalArgumentException("unknown layer");
    }
  }

  public long fetch(String path, long nowMs) {
    if (!transport.scripts.containsKey(path)) throw new NoSuchElementException("an unscripted path");
    Answer answer = top.call(path, nowMs);
    elapsed = answer.took();
    return answer.status();
  }

  public long upstreamCalls() {
    return transport.calls;
  }

  public long elapsedMs() {
    return elapsed;
  }

  // The extension round: one more layer, which only needs the same call as the rest.
  public void hedge(long afterMs) {
    if (afterMs < 0) throw new IllegalArgumentException("a negative delay");
    top = new Hedge(top, afterMs);
  }
}
