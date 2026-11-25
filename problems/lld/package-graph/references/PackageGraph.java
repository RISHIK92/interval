import java.util.*;

// Each package keeps the packages it uses, in declared order, and the reverse links to
// its dependents. Dependencies must already exist, so the graph never has a cycle.
public class PackageGraph {
  private final Map<String, List<String>> deps = new HashMap<>();
  private final Map<String, TreeSet<String>> users = new HashMap<>();
  private final Set<String> pinned = new HashSet<>();

  public PackageGraph() {}

  private static void named(String name) {
    if (name.isEmpty()) throw new IllegalArgumentException("package names are not empty");
  }

  private TreeSet<String> usersOf(String pkg) {
    named(pkg);
    TreeSet<String> found = users.get(pkg);
    if (found == null) throw new IllegalArgumentException("unknown package");
    return found;
  }

  public boolean add(String pkg, List<String> deps) {
    named(pkg);
    for (String d : deps) named(d);
    if (new HashSet<>(deps).size() != deps.size()) throw new IllegalArgumentException("a dependency is listed twice");
    if (this.deps.containsKey(pkg)) return false;
    for (String d : deps) if (!this.deps.containsKey(d)) return false;
    this.deps.put(pkg, new ArrayList<>(deps));
    users.put(pkg, new TreeSet<>());
    for (String d : deps) users.get(d).add(pkg);
    return true;
  }

  public boolean remove(String pkg) {
    named(pkg);
    TreeSet<String> found = users.get(pkg);
    if (found == null || !found.isEmpty()) return false;
    for (String d : deps.remove(pkg)) users.get(d).remove(pkg);
    users.remove(pkg);
    pinned.remove(pkg);
    return true;
  }

  public List<String> dependents(String pkg) {
    return new ArrayList<>(usersOf(pkg));
  }

  public List<String> installOrder(String pkg) {
    usersOf(pkg);
    List<String> order = new ArrayList<>();
    visit(pkg, order, new HashSet<>());
    return order;
  }

  private void visit(String p, List<String> order, Set<String> listed) {
    if (listed.contains(p)) return;
    for (String d : deps.get(p)) visit(d, order, listed);
    listed.add(p);
    order.add(p);
  }

  // The extension round: pinned packages are never unused.
  public void pin(String pkg) {
    usersOf(pkg);
    pinned.add(pkg);
  }

  public List<String> unused() {
    TreeSet<String> out = new TreeSet<>();
    for (Map.Entry<String, TreeSet<String>> e : users.entrySet())
      if (e.getValue().isEmpty() && !pinned.contains(e.getKey())) out.add(e.getKey());
    return new ArrayList<>(out);
  }
}
