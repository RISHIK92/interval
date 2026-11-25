import java.util.*;
import java.util.function.Supplier;

public class AlertTree {
  // A component: a rule (a leaf) or a group (a composite). Callers evaluate, count and
  // mute either the same way, without asking which one they hold.
  private abstract static class Node {
    final String name;
    Group parent;
    boolean muted = false;

    Node(String name, Group parent) {
      this.name = name;
      this.parent = parent;
    }

    String path() {
      if (parent == null) return "/";
      String above = parent.path();
      return above.equals("/") ? "/" + name : above + "/" + name;
    }

    // Adds the paths of this node's unmuted rules that fire.
    abstract void firing(Map<String, Long> metrics, List<String> out);

    abstract long count();
  }

  private static final class Rule extends Node {
    private final String metric;
    private final long threshold;

    Rule(String name, Group parent, String metric, long threshold) {
      super(name, parent);
      this.metric = metric;
      this.threshold = threshold;
    }

    void firing(Map<String, Long> metrics, List<String> out) {
      Long value = metrics.get(metric);
      if (!muted && value != null && value > threshold) out.add(path());
    }

    long count() {
      return 1;
    }
  }

  private static final class Group extends Node {
    final Map<String, Node> children = new HashMap<>();

    Group(String name, Group parent) {
      super(name, parent);
    }

    void firing(Map<String, Long> metrics, List<String> out) {
      // A muted group silences everything under it, whatever their own flags say.
      if (!muted) for (Node child : children.values()) child.firing(metrics, out);
    }

    long count() {
      long total = 0;
      for (Node child : children.values()) total += child.count();
      return total;
    }
  }

  private static void checkName(String name) {
    if (name.isEmpty() || name.contains("/"))
      throw new IllegalArgumentException("a name is non-empty and has no slash");
  }

  private final Group root = new Group("", null);

  public boolean group(String parent, String name) {
    Group at = groupAt(parent);
    checkName(name);
    return attach(at, name, () -> new Group(name, at));
  }

  public boolean rule(String parent, String name, String metric, long threshold) {
    Group at = groupAt(parent);
    checkName(name);
    if (metric.isEmpty()) throw new IllegalArgumentException("empty metric");
    return attach(at, name, () -> new Rule(name, at, metric, threshold));
  }

  public boolean mute(String node, boolean on) {
    Node found = find(node);
    if (found.muted == on) return false;
    found.muted = on;
    return true;
  }

  public List<String> firing(Map<String, Long> metrics) {
    List<String> out = new ArrayList<>();
    root.firing(metrics, out);
    Collections.sort(out);
    return out;
  }

  public long count(String node) {
    return find(node).count();
  }

  // The extension round: moving a subtree, with its mutes.
  public boolean moveNode(String node, String parent) {
    Node moving = find(node);
    Group to = groupAt(parent);
    if (moving.parent == null) throw new IllegalArgumentException("the root stays where it is");
    // A group can't go under itself or anything below it: that would cut it off.
    boolean inside = (to.path() + "/").startsWith(moving.path() + "/");
    if (inside || to.children.containsKey(moving.name)) return false;
    moving.parent.children.remove(moving.name);
    moving.parent = to;
    to.children.put(moving.name, moving);
    return true;
  }

  private static boolean attach(Group at, String name, Supplier<Node> make) {
    if (at.children.containsKey(name)) return false;
    at.children.put(name, make.get());
    return true;
  }

  private Node find(String path) {
    if (path.equals("/")) return root;
    if (!path.startsWith("/")) throw new IllegalArgumentException("a path starts with a slash");
    Node at = root;
    for (String part : path.substring(1).split("/", -1)) {
      Node next = at instanceof Group ? ((Group) at).children.get(part) : null;
      if (next == null) throw new IllegalArgumentException("no such node");
      at = next;
    }
    return at;
  }

  private Group groupAt(String path) {
    Node found = find(path);
    if (!(found instanceof Group)) throw new IllegalArgumentException("a rule has no children");
    return (Group) found;
  }
}
