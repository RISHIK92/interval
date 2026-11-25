import java.util.*;

// Services are registered with a lifetime and named dependencies, and nothing is made
// until something asks for it. The lifetime decides where an instance is kept: once for
// the container, once per scope, or nowhere (a new one every time).
public class DiContainer {
  private static final Set<String> LIFETIMES = Set.of("singleton", "transient", "scoped");

  // How to make one service: its lifetime, what it needs, and how many it has made. Each
  // instance is its service's name and number, followed by the instances it was given, so
  // the string shows exactly which instances are shared.
  private static final class Provider {
    final String service;
    final String lifetime;
    final List<String> deps;
    long made = 0;
    final List<String> wrappers = new ArrayList<>();

    Provider(String service, String lifetime, List<String> deps) {
      this.service = service;
      this.lifetime = lifetime;
      this.deps = new ArrayList<>(deps);
    }

    String construct(List<String> given) {
      made += 1;
      String instance = service + "#" + made;
      if (!given.isEmpty()) instance += "(" + String.join(",", given) + ")";
      for (String wrapper : wrappers) instance = wrapper + "[" + instance + "]";
      return instance;
    }
  }

  private static void given(String value) {
    if (value.isEmpty()) throw new IllegalArgumentException("empty");
  }

  private final Map<String, Provider> providers = new HashMap<>();
  private final Map<String, String> singletons = new HashMap<>();
  private final Map<String, Map<String, String>> scopes = new HashMap<>();

  public void provide(String service, String lifetime, List<String> deps) {
    given(service);
    if (!LIFETIMES.contains(lifetime)) throw new IllegalArgumentException("unknown lifetime");
    for (String dep : deps) given(dep);
    if (new HashSet<>(deps).size() != deps.size())
      throw new IllegalArgumentException("a dependency listed twice");
    if (providers.containsKey(service)) throw new IllegalArgumentException("already provided");
    providers.put(service, new Provider(service, lifetime, deps));
  }

  public String resolve(String service, String scope) {
    given(scope);
    // Check the whole graph first, so a resolve that fails constructs nothing.
    check(service, false, new HashSet<>(), new HashSet<>());
    return instance(service, scope);
  }

  public long constructed(String service) {
    return provider(service).made;
  }

  public long endScope(String scope) {
    given(scope);
    Map<String, String> ended = scopes.remove(scope);
    return ended == null ? 0 : ended.size();
  }

  // The extension round: wrapping a service without changing it.
  public void decorate(String service, String wrapper) {
    given(wrapper);
    provider(service).wrappers.add(wrapper);
  }

  private Provider provider(String service) {
    Provider found = providers.get(service);
    if (found == null) throw new IllegalArgumentException("unknown service");
    return found;
  }

  private void check(String service, boolean inSingleton, Set<String> path, Set<String> done) {
    Provider provider = provider(service);
    if (path.contains(service)) throw new IllegalArgumentException("a dependency cycle");
    if (inSingleton && provider.lifetime.equals("scoped"))
      throw new IllegalArgumentException("a singleton would hold on to a scoped instance");
    String key = inSingleton + " " + service;
    if (done.contains(key)) return;
    path.add(service);
    for (String dep : provider.deps)
      check(dep, inSingleton || provider.lifetime.equals("singleton"), path, done);
    path.remove(service);
    done.add(key);
  }

  private String instance(String service, String scope) {
    Provider provider = providers.get(service);
    Map<String, String> kept = null;
    if (provider.lifetime.equals("singleton")) kept = singletons;
    else if (provider.lifetime.equals("scoped")) kept = scopes.computeIfAbsent(scope, s -> new HashMap<>());
    if (kept != null && kept.containsKey(service)) return kept.get(service);
    List<String> deps = new ArrayList<>();
    for (String dep : provider.deps) deps.add(instance(dep, scope));
    String built = provider.construct(deps);
    if (kept != null) kept.put(service, built);
    return built;
  }
}
