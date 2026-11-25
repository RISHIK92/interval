import java.util.*;

public class DocTree {
  // A path is a list of segments: a key steps into an object, an index into an array.
  private record Segment(String key, int index) {
    boolean isIndex() {
      return key == null;
    }
  }

  private static Segment key(String text) {
    if (text.isEmpty()) throw new IllegalArgumentException("not a key");
    for (char c : text.toCharArray()) {
      boolean ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
      if (!ok) throw new IllegalArgumentException("not a key");
    }
    return new Segment(text, 0);
  }

  private static Segment index(String text) {
    if (text.isEmpty() || (text.charAt(0) == '0' && !text.equals("0")))
      throw new IllegalArgumentException("not an index");
    for (char c : text.toCharArray()) if (c < '0' || c > '9') throw new IllegalArgumentException("not an index");
    return new Segment(null, Integer.parseInt(text));
  }

  private static List<Segment> parse(String path) {
    List<Segment> segments = new ArrayList<>();
    if (path.isEmpty()) return segments;
    for (String part : path.split("\\.", -1)) {
      String[] pieces = part.split("\\[", -1);
      segments.add(key(pieces[0]));
      for (int i = 1; i < pieces.length; i++) {
        if (!pieces[i].endsWith("]")) throw new IllegalArgumentException("an unclosed [");
        segments.add(index(pieces[i].substring(0, pieces[i].length() - 1)));
      }
    }
    return segments;
  }

  private static String join(String at, Segment s) {
    if (s.isIndex()) return at + "[" + s.index() + "]";
    return at.isEmpty() ? s.key() : at + "." + s.key();
  }

  // The composite: scalars, objects and arrays answer the same questions, and a branch
  // answers by asking its children.
  private interface Node {
    Node child(Segment s);

    String summary();

    long size();

    List<String> leaves(String at);
  }

  // A branch can also grow and shrink.
  private interface Branch extends Node {
    boolean room(Segment s);

    void attach(Segment s, Node n);

    void detach(Segment s);
  }

  private static final class Scalar implements Node {
    String value;

    Scalar(String value) {
      this.value = value;
    }

    public Node child(Segment s) {
      return null;
    }

    public String summary() {
      return value;
    }

    public long size() {
      return 0;
    }

    public List<String> leaves(String at) {
      return List.of(at);
    }
  }

  private static final class ObjectNode implements Branch {
    final TreeMap<String, Node> children = new TreeMap<>();

    public Node child(Segment s) {
      return s.isIndex() ? null : children.get(s.key());
    }

    public boolean room(Segment s) {
      return !s.isIndex();
    }

    public void attach(Segment s, Node n) {
      children.put(s.key(), n);
    }

    public void detach(Segment s) {
      children.remove(s.key());
    }

    public String summary() {
      return "object(" + children.size() + ")";
    }

    public long size() {
      long total = 0;
      for (Node c : children.values()) total += 1 + c.size();
      return total;
    }

    public List<String> leaves(String at) {
      List<String> out = new ArrayList<>();
      for (Map.Entry<String, Node> e : children.entrySet())
        out.addAll(e.getValue().leaves(join(at, new Segment(e.getKey(), 0))));
      return out;
    }
  }

  private static final class ArrayNode implements Branch {
    final List<Node> items = new ArrayList<>();

    public Node child(Segment s) {
      return s.isIndex() && s.index() < items.size() ? items.get(s.index()) : null;
    }

    // An array only grows at its end.
    public boolean room(Segment s) {
      return s.isIndex() && s.index() == items.size();
    }

    public void attach(Segment s, Node n) {
      items.add(n);
    }

    public void detach(Segment s) {
      items.remove(s.index());
    }

    public String summary() {
      return "array(" + items.size() + ")";
    }

    public long size() {
      long total = 0;
      for (Node item : items) total += 1 + item.size();
      return total;
    }

    public List<String> leaves(String at) {
      List<String> out = new ArrayList<>();
      for (int i = 0; i < items.size(); i++) out.addAll(items.get(i).leaves(join(at, new Segment(null, i))));
      return out;
    }
  }

  private final ObjectNode root = new ObjectNode();

  public boolean put(String path, String val) {
    List<Segment> segments = parse(path);
    if (segments.isEmpty() || val.isEmpty()) throw new IllegalArgumentException("a scalar root or an empty value");
    Walk w = walk(segments);
    if (!w.rest().isEmpty()) return grow(w.node(), w.rest(), new Scalar(val));
    if (!(w.node() instanceof Scalar v)) return false;
    v.value = val;
    return true;
  }

  public String read(String path) {
    Node n = find(parse(path));
    return n == null ? null : n.summary();
  }

  public boolean remove(String path) {
    List<Segment> segments = parse(path);
    if (segments.isEmpty()) throw new IllegalArgumentException("the root stays");
    Segment last = segments.get(segments.size() - 1);
    Node parent = find(segments.subList(0, segments.size() - 1));
    if (!(parent instanceof Branch b) || b.child(last) == null) return false;
    b.detach(last);
    return true;
  }

  public List<String> paths(String prefix) {
    Node n = find(parse(prefix));
    return n == null ? new ArrayList<>() : n.leaves(prefix);
  }

  public long count(String path) {
    Node n = find(parse(path));
    if (n == null) throw new NoSuchElementException("no such node");
    return n.size();
  }

  // The extension round: a shallow merge of scalars into one object.
  public long merge(String path, Map<String, String> entries) {
    List<Segment> segments = parse(path);
    for (Map.Entry<String, String> e : entries.entrySet()) {
      key(e.getKey());
      if (e.getValue().isEmpty()) throw new IllegalArgumentException("an empty value");
    }
    Walk w = walk(segments);
    Node n = w.node();
    if (!w.rest().isEmpty()) {
      ObjectNode made = new ObjectNode();
      if (!grow(n, w.rest(), made)) throw new IllegalArgumentException("the path can't be made");
      n = made;
    }
    if (!(n instanceof ObjectNode target)) throw new IllegalArgumentException("only an object can be merged into");
    long changed = 0;
    for (Map.Entry<String, String> e : entries.entrySet()) {
      if (target.children.get(e.getKey()) instanceof Scalar old && old.value.equals(e.getValue())) continue;
      target.children.put(e.getKey(), new Scalar(e.getValue()));
      changed++;
    }
    return changed;
  }

  private record Walk(Node node, List<Segment> rest) {}

  // Follows the path as far as it exists: the last node reached and the segments to go.
  private Walk walk(List<Segment> segments) {
    Node n = root;
    for (int i = 0; i < segments.size(); i++) {
      Node c = n.child(segments.get(i));
      if (c == null) return new Walk(n, segments.subList(i, segments.size()));
      n = c;
    }
    return new Walk(n, List.of());
  }

  private Node find(List<Segment> segments) {
    Walk w = walk(segments);
    return w.rest().isEmpty() ? w.node() : null;
  }

  // Creates the missing part of a path, each new branch an object or an array as the
  // segment after it needs, or refuses without changing anything.
  private static boolean grow(Node parent, List<Segment> rest, Node leaf) {
    if (!(parent instanceof Branch b) || !b.room(rest.get(0))) return false;
    // Every array made here is new and empty, so it can only take index 0.
    for (Segment s : rest.subList(1, rest.size())) if (s.isIndex() && s.index() != 0) return false;
    for (int i = 0; i + 1 < rest.size(); i++) {
      Branch made = rest.get(i + 1).isIndex() ? new ArrayNode() : new ObjectNode();
      b.attach(rest.get(i), made);
      b = made;
    }
    b.attach(rest.get(rest.size() - 1), leaf);
    return true;
  }
}
