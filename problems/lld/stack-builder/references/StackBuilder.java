import java.util.*;
import java.util.function.Function;

// A builder: resources and dependencies accumulate step by step, by hand or a recipe at a
// time, and nothing is ordered until the plan is asked for. Dependencies never form a
// cycle, because a link that would close one is refused when it's added.
public class StackBuilder {
  // Each kind's required properties.
  private static final Map<String, List<String>> REQUIRED =
      Map.of(
          "bucket", List.of("region"),
          "queue", List.of("region"),
          "database", List.of("engine", "size"),
          "service", List.of("image", "port"),
          "worker", List.of("image"),
          "balancer", List.of("port"));

  private static final class Resource {
    final String kind;
    final String name;
    final Map<String, String> props;
    final List<String> needs = new ArrayList<>(); // resources this one depends on
    final List<String> neededBy = new ArrayList<>(); // resources that depend on this one

    Resource(String kind, String name, Map<String, String> props) {
      this.kind = kind;
      this.name = name;
      this.props = new HashMap<>(props);
    }
  }

  private record Part(String kind, String name, Map<String, String> props) {}

  // An abstract factory for a family of resources that belong together. A recipe names its
  // parts after the name it's given and says how they depend on each other.
  private interface Recipe {
    List<Part> resources(String name);

    List<String[]> links(String name);
  }

  private static final class WebRecipe implements Recipe {
    public List<Part> resources(String name) {
      return List.of(
          new Part("balancer", name + "-lb", Map.of("port", "443")),
          new Part("service", name + "-app", Map.of("image", name + ":latest", "port", "8080")),
          new Part("database", name + "-db", Map.of("engine", "postgres", "size", "small")));
    }

    public List<String[]> links(String name) {
      return List.of(
          new String[] {name + "-lb", name + "-app"}, new String[] {name + "-app", name + "-db"});
    }
  }

  private static final class WorkerRecipe implements Recipe {
    public List<Part> resources(String name) {
      return List.of(
          new Part("queue", name + "-jobs", Map.of("region", "us-east-1")),
          new Part("worker", name + "-worker", Map.of("image", name + ":latest")));
    }

    public List<String[]> links(String name) {
      return List.<String[]>of(new String[] {name + "-worker", name + "-jobs"});
    }
  }

  private static final Map<String, Recipe> RECIPES =
      Map.of("web", new WebRecipe(), "worker", new WorkerRecipe());

  private static void given(String value) {
    if (value.isEmpty()) throw new IllegalArgumentException("empty");
  }

  private final String stack;
  private final Map<String, Resource> resources = new HashMap<>();

  public StackBuilder(String name) {
    given(name);
    this.stack = name;
  }

  public boolean resource(String kind, String name, Map<String, String> props) {
    if (!REQUIRED.containsKey(kind)) throw new IllegalArgumentException("unknown kind");
    given(name);
    for (var prop : props.entrySet()) {
      given(prop.getKey());
      given(prop.getValue());
    }
    if (resources.containsKey(name)) return false;
    resources.put(name, new Resource(kind, name, props));
    return true;
  }

  public boolean dependsOn(String a, String b) {
    Resource first = known(a);
    Resource second = known(b);
    if (a.equals(b)) throw new IllegalArgumentException("a resource can't depend on itself");
    if (first.needs.contains(b) || reachable(b).contains(a)) return false;
    first.needs.add(b);
    second.neededBy.add(a);
    return true;
  }

  public long preset(String recipe, String name) {
    Recipe found = RECIPES.get(recipe);
    if (found == null) throw new IllegalArgumentException("unknown recipe");
    given(name);
    List<Part> parts = found.resources(name);
    for (Part part : parts) if (resources.containsKey(part.name())) return 0;
    for (Part part : parts) resource(part.kind(), part.name(), part.props());
    for (String[] link : found.links(name)) dependsOn(link[0], link[1]);
    return parts.size();
  }

  public List<String> validate() {
    List<String> problems = new ArrayList<>();
    for (Resource r : resources.values())
      for (String prop : REQUIRED.get(r.kind))
        if (!r.props.containsKey(prop)) problems.add(r.name + ": missing " + prop);
    Collections.sort(problems);
    return problems;
  }

  public List<String> plan() {
    if (!validate().isEmpty()) throw new IllegalStateException("the stack isn't valid");
    return order(r -> r.needs, r -> r.neededBy);
  }

  // The extension round: tearing the stack down.
  public List<String> destroyPlan() {
    return order(r -> r.neededBy, r -> r.needs);
  }

  private Resource known(String name) {
    Resource found = resources.get(name);
    if (found == null) throw new IllegalArgumentException("unknown resource");
    return found;
  }

  // Every resource `start` depends on, directly or not.
  private Set<String> reachable(String start) {
    Set<String> seen = new HashSet<>(List.of(start));
    List<String> reached = new ArrayList<>(List.of(start));
    for (int i = 0; i < reached.size(); i++)
      for (String need : resources.get(reached.get(i)).needs)
        if (seen.add(need)) reached.add(need);
    return seen;
  }

  // Kahn's algorithm: a resource comes once everything `before` it has, and among those
  // ready, the smallest name goes first.
  private List<String> order(
      Function<Resource, List<String>> before, Function<Resource, List<String>> after) {
    Map<String, Integer> waiting = new HashMap<>();
    PriorityQueue<String> ready = new PriorityQueue<>();
    for (Resource r : resources.values()) {
      waiting.put(r.name, before.apply(r).size());
      if (before.apply(r).isEmpty()) ready.add(r.name);
    }
    List<String> out = new ArrayList<>();
    for (int i = 0; i < resources.size(); i++) {
      Resource resource = resources.get(ready.poll());
      out.add(resource.kind + " " + stack + "/" + resource.name);
      for (String name : after.apply(resource)) {
        waiting.merge(name, -1, Integer::sum);
        if (waiting.get(name) == 0) ready.add(name);
      }
    }
    return out;
  }
}
