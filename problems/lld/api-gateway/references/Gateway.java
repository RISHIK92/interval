import java.util.*;

public class Gateway {
  private static final String NONE = "-";

  private static void checkPath(String path) {
    if (!path.startsWith("/")) throw new IllegalArgumentException("a path starts with /");
  }

  private static void checkPrefix(String prefix) {
    checkPath(prefix);
    if (!prefix.equals("/") && prefix.endsWith("/")) throw new IllegalArgumentException("only / ends with /");
  }

  private static boolean matches(String prefix, String path) {
    return prefix.equals("/") || path.equals(prefix) || path.startsWith(prefix + "/");
  }

  // Prefixes that match one path are nested, so the longest is the most specific.
  private static String longest(Set<String> prefixes, String path) {
    String best = null;
    for (String prefix : prefixes)
      if (matches(prefix, path) && (best == null || prefix.length() > best.length())) best = prefix;
    return best;
  }

  // A fake upstream: answers with its statuses in order, then repeats the last.
  private static final class ScriptedService {
    private final List<Long> statuses;
    private int served = 0;

    ScriptedService(List<Long> statuses) {
      this.statuses = List.copyOf(statuses);
    }

    long answer() {
      long status = statuses.get(Math.min(served, statuses.size() - 1));
      served++;
      return status;
    }
  }

  private record Cached(long status, long expires) {}

  // One prefix's settings and, when it caches, its own responses by path.
  private static final class Route {
    String service;
    boolean auth = false;
    long ttl = 0;
    final Map<String, Cached> cached = new HashMap<>();

    Route(String service) {
      this.service = service;
    }
  }

  // The facade: one request call hides routing, the auth check, the response cache (a
  // proxy in front of each service) and the services themselves.
  private final Map<String, Route> routes = new HashMap<>();
  private final Map<String, ScriptedService> services = new HashMap<>();
  private final Map<String, String> rewrites = new HashMap<>();

  public void route(String prefix, String service) {
    checkPrefix(prefix);
    if (service.isEmpty()) throw new IllegalArgumentException("an empty service");
    Route found = routes.get(prefix);
    if (found == null) {
      routes.put(prefix, new Route(service));
    } else {
      found.service = service;
      found.cached.clear();
    }
  }

  public void requireAuth(String prefix) {
    find(prefix).auth = true;
  }

  public void cache(String prefix, long ttlMs) {
    Route route = find(prefix);
    if (ttlMs < 1) throw new IllegalArgumentException("a ttl is at least 1 ms");
    route.ttl = ttlMs;
  }

  public void upstream(String service, List<Long> statuses) {
    if (service.isEmpty() || statuses.isEmpty()) throw new IllegalArgumentException("an empty service or script");
    for (long s : statuses) if (s < 100 || s > 599) throw new IllegalArgumentException("not an HTTP status");
    services.put(service, new ScriptedService(statuses));
  }

  public List<String> request(String path, String token, long nowMs) {
    checkPath(path);
    String rewrite = longest(rewrites.keySet(), path);
    if (rewrite != null) path = rewrites.get(rewrite) + path.substring(rewrite.length());
    String prefix = longest(routes.keySet(), path);
    if (prefix == null) return List.of("404", NONE, NONE);
    Route route = routes.get(prefix);
    if (route.auth && token.isEmpty()) return List.of("401", NONE, NONE);
    Cached kept = route.cached.get(path);
    if (kept != null && nowMs < kept.expires()) return List.of(Long.toString(kept.status()), route.service, "hit");
    ScriptedService service = services.get(route.service);
    if (service == null) return List.of("502", NONE, NONE);
    long status = service.answer();
    if (route.ttl == 0) return List.of(Long.toString(status), route.service, NONE);
    if (status == 200) route.cached.put(path, new Cached(status, nowMs + route.ttl));
    return List.of(Long.toString(status), route.service, "miss");
  }

  // The extension round: a path rewrite in front of the routing.
  public void rewrite(String prefix, String replacement) {
    checkPrefix(prefix);
    checkPrefix(replacement);
    if (prefix.equals("/") || replacement.equals("/")) throw new IllegalArgumentException("/ can't be rewritten");
    rewrites.put(prefix, replacement);
  }

  private Route find(String prefix) {
    Route route = routes.get(prefix);
    if (route == null) throw new NoSuchElementException("no such route");
    return route;
  }
}
