import java.util.*;

// Nodes compose: each holds its children, and removing one takes its subtree. Grants
// associate a member with a node by name; members are never nodes.
public class ResourceTree {
  private static final Map<String, String> PARENT_KIND =
      Map.of("folder", "organization", "project", "folder", "resource", "project");

  private static final class Node {
    final String kind;
    String parent;
    final Set<String> children = new HashSet<>();
    final Set<List<String>> grants = new HashSet<>();
    final Set<List<String>> denies = new HashSet<>();

    Node(String kind, String parent) {
      this.kind = kind;
      this.parent = parent;
    }
  }

  private final String org;
  private final Map<String, Node> nodes = new HashMap<>();

  public ResourceTree(String org) {
    named(org);
    this.org = org;
    nodes.put(org, new Node("organization", null));
  }

  private static void named(String... names) {
    for (String n : names)
      if (n.isEmpty()) throw new IllegalArgumentException("names, kinds, roles and members are not empty");
  }

  private Node get(String node) {
    named(node);
    Node found = nodes.get(node);
    if (found == null) throw new IllegalArgumentException("unknown node");
    return found;
  }

  private static boolean fits(String kind, Node parent) {
    return PARENT_KIND.get(kind).equals(parent.kind);
  }

  public boolean addNode(String parent, String node, String kind) {
    named(parent, node, kind);
    if (!PARENT_KIND.containsKey(kind)) throw new IllegalArgumentException("unknown kind");
    Node holder = nodes.get(parent);
    if (holder == null || nodes.containsKey(node) || !fits(kind, holder)) return false;
    nodes.put(node, new Node(kind, parent));
    holder.children.add(node);
    return true;
  }

  public void attach(String node, String role, String member) {
    named(role, member);
    get(node).grants.add(List.of(role, member));
  }

  public boolean can(String member, String role, String node) {
    named(member, role);
    List<String> key = List.of(role, member);
    boolean granted = false;
    for (Node at = get(node); at != null; at = at.parent == null ? null : nodes.get(at.parent)) {
      if (at.denies.contains(key)) return false;
      if (at.grants.contains(key)) granted = true;
    }
    return granted;
  }

  public boolean move(String node, String parent) {
    named(node, parent);
    Node moving = nodes.get(node);
    Node holder = nodes.get(parent);
    if (moving == null || holder == null || node.equals(org)) return false;
    if (!fits(moving.kind, holder)) return false;
    nodes.get(moving.parent).children.remove(node);
    holder.children.add(node);
    moving.parent = parent;
    return true;
  }

  public long remove(String node) {
    Node found = get(node);
    if (node.equals(org)) throw new IllegalArgumentException("the organization can't be removed");
    nodes.get(found.parent).children.remove(node);
    return drop(node);
  }

  private long drop(String node) {
    long count = 1;
    for (String child : nodes.get(node).children) count += drop(child);
    nodes.remove(node);
    return count;
  }

  // The extension round: a deny below or above overrides every grant.
  public void deny(String node, String role, String member) {
    named(role, member);
    get(node).denies.add(List.of(role, member));
  }
}
