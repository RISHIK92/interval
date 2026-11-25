import java.util.*;

public class CostTree {
  // A component: a service (a leaf) or a unit (a composite). Anyone asking for a total
  // asks the node, whichever it is.
  private abstract static class CostNode {
    final String name;
    Unit parent;
    long shared = 0; // cents allocated to this node from above (the extension)

    CostNode(String name, Unit parent) {
      this.name = name;
      this.parent = parent;
    }

    abstract long total();

    abstract List<CostNode> children();
  }

  private static final class Service extends CostNode {
    private final long cents;

    Service(String name, Unit parent, long cents) {
      super(name, parent);
      this.cents = cents;
    }

    long total() {
      return cents + shared;
    }

    List<CostNode> children() {
      return new ArrayList<>();
    }
  }

  private static final class Unit extends CostNode {
    final Map<String, CostNode> members = new HashMap<>();

    Unit(String name, Unit parent) {
      super(name, parent);
    }

    long total() {
      long sum = shared;
      for (CostNode child : members.values()) sum += child.total();
      return sum;
    }

    List<CostNode> children() {
      return new ArrayList<>(members.values());
    }

    // Whether this unit is node itself or somewhere under it.
    boolean within(CostNode node) {
      return this == node || (parent != null && parent.within(node));
    }
  }

  private static void given(String value) {
    if (value.isEmpty()) throw new IllegalArgumentException("empty");
  }

  private final Map<String, CostNode> nodes = new HashMap<>();

  public CostTree(String root) {
    given(root);
    nodes.put(root, new Unit(root, null));
  }

  public boolean unit(String parent, String name) {
    Unit at = unitAt(parent);
    given(name);
    return attach(at, new Unit(name, at));
  }

  public boolean service(String parent, String name, long cents) {
    Unit at = unitAt(parent);
    given(name);
    if (cents < 0) throw new IllegalArgumentException("a cost is never negative");
    return attach(at, new Service(name, at, cents));
  }

  public long total(String node) {
    return find(node).total();
  }

  public boolean move(String node, String parent) {
    CostNode moving = find(node);
    Unit to = unitAt(parent);
    if (moving.parent == null) throw new IllegalArgumentException("the root stays where it is");
    if (moving.parent == to || to.within(moving)) return false;
    moving.parent.members.remove(moving.name);
    moving.parent = to;
    to.members.put(moving.name, moving);
    return true;
  }

  public List<String> top(String node, long n) {
    CostNode found = find(node);
    if (n < 0) throw new IllegalArgumentException("n is never negative");
    List<CostNode> ranked = found.children();
    ranked.sort(
        Comparator.comparingLong((CostNode child) -> -child.total())
            .thenComparing(child -> child.name));
    List<String> out = new ArrayList<>();
    for (CostNode child : ranked.subList(0, (int) Math.min(n, ranked.size())))
      out.add(child.name + " " + child.total());
    return out;
  }

  // The extension round: a cost shared by everything directly under a unit.
  public void sharedCost(String node, long cents) {
    Unit found = unitAt(node);
    if (cents < 0) throw new IllegalArgumentException("a cost is never negative");
    List<CostNode> children = found.children();
    if (children.isEmpty()) throw new IllegalArgumentException("nothing to share with");
    children.sort(Comparator.comparing(child -> child.name));
    long each = cents / children.size();
    long extra = cents % children.size();
    for (int i = 0; i < children.size(); i++) children.get(i).shared += each + (i < extra ? 1 : 0);
  }

  private boolean attach(Unit at, CostNode node) {
    if (nodes.containsKey(node.name)) return false;
    at.members.put(node.name, node);
    nodes.put(node.name, node);
    return true;
  }

  private CostNode find(String name) {
    CostNode found = nodes.get(name);
    if (found == null) throw new IllegalArgumentException("no such node");
    return found;
  }

  private Unit unitAt(String name) {
    CostNode found = find(name);
    if (!(found instanceof Unit)) throw new IllegalArgumentException("a service has nothing under it");
    return (Unit) found;
  }
}
