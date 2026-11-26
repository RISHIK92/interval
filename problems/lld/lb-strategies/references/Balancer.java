import java.util.*;
import java.util.function.Supplier;

// Picks a backend for each new connection with a strategy that can be swapped at
// runtime. The balancer owns the backends and their connection counts; a strategy owns
// only its own position, so a new one starts fresh and loses no connections.
public class Balancer {
  private static final long MAX_WEIGHT = 100;

  private static final class Backend {
    final String name;
    final long weight;
    long open = 0;
    boolean drained = false;

    Backend(String name, long weight) {
      this.name = name;
      this.weight = weight;
    }
  }

  private interface Strategy {
    Backend choose(List<Backend> backends);
  }

  // The backend after the one picked last, in the order they were added, wrapping.
  private static final class RoundRobin implements Strategy {
    private int last = -1;

    public Backend choose(List<Backend> backends) {
      int count = backends.size();
      for (int step = 0; step < count; step++) {
        int at = (last + 1 + step) % count;
        if (!backends.get(at).drained) {
          last = at;
          return backends.get(at);
        }
      }
      throw new IllegalStateException("no backend to pick");
    }
  }

  // The backend with the fewest open connections; a tie goes to the one added first.
  private static final class LeastConnections implements Strategy {
    public Backend choose(List<Backend> backends) {
      Backend best = null;
      for (Backend backend : backends)
        if (!backend.drained && (best == null || backend.open < best.open)) best = backend;
      if (best == null) throw new IllegalStateException("no backend to pick");
      return best;
    }
  }

  // Smooth weighted round robin: every pick, each backend's current weight grows by its
  // weight, the largest is picked (a tie goes to the one added first), and the pick
  // gives back the total, so heavy backends are spread out instead of picked in a row.
  private static final class SmoothWeighted implements Strategy {
    private final Map<String, Long> current = new HashMap<>();

    public Backend choose(List<Backend> backends) {
      Backend best = null;
      long total = 0;
      for (Backend backend : backends) {
        if (backend.drained) continue;
        total += backend.weight;
        current.merge(backend.name, backend.weight, Long::sum);
        if (best == null || current.get(backend.name) > current.get(best.name)) best = backend;
      }
      if (best == null) throw new IllegalStateException("no backend to pick");
      current.merge(best.name, -total, Long::sum);
      return best;
    }
  }

  private static final Map<String, Supplier<Strategy>> STRATEGIES =
      Map.of(
          "round-robin", RoundRobin::new,
          "least-connections", LeastConnections::new,
          "weighted-round-robin", SmoothWeighted::new);

  private final List<Backend> backends = new ArrayList<>();
  private final Map<String, Backend> byName = new HashMap<>();
  private Strategy strategy;

  public Balancer(String strategy) {
    this.strategy = fresh(strategy);
  }

  public void addBackend(String name, long weight) {
    if (name.isEmpty() || byName.containsKey(name) || weight < 1 || weight > MAX_WEIGHT)
      throw new IllegalArgumentException("bad backend");
    Backend backend = new Backend(name, weight);
    backends.add(backend);
    byName.put(name, backend);
  }

  public String pick() {
    Backend backend = strategy.choose(backends);
    backend.open += 1;
    return backend.name;
  }

  public void done(String backend) {
    Backend found = backend(backend);
    if (found.open == 0) throw new IllegalStateException("no open connection");
    found.open -= 1;
  }

  public void useStrategy(String strategy) {
    this.strategy = fresh(strategy);
  }

  // The extension round: taking a backend out of rotation.
  public void drain(String backend) {
    Backend found = backend(backend);
    if (found.drained) throw new IllegalStateException("already drained");
    found.drained = true;
  }

  private Backend backend(String name) {
    Backend found = byName.get(name);
    if (found == null) throw new IllegalArgumentException("unknown backend");
    return found;
  }

  private static Strategy fresh(String strategy) {
    Supplier<Strategy> make = STRATEGIES.get(strategy);
    if (make == null) throw new IllegalArgumentException("unknown strategy");
    return make.get();
  }
}
