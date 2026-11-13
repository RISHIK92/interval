import java.util.*;

public class FileSystem {
  private static final class Node {
    final boolean dir;
    String text = "";
    final TreeMap<String, Node> kids = new TreeMap<>();

    Node(boolean dir) {
      this.dir = dir;
    }
  }

  // One monitor for the whole tree: mv touches two directories at once, and a lock per
  // directory would need an ordering to avoid deadlock.
  private final Node root = new Node(true);

  private static List<String> split(String path) {
    if (!path.startsWith("/")) throw new IllegalArgumentException("invalid path");
    List<String> out = new ArrayList<>();
    for (String s : path.split("/")) {
      if (s.isEmpty() || s.equals(".")) continue;
      if (s.equals("..")) {
        if (out.isEmpty()) throw new IllegalArgumentException("invalid path");
        out.remove(out.size() - 1);
      } else out.add(s);
    }
    return out;
  }

  private Node walk(List<String> parts) {
    Node n = root;
    for (String p : parts) {
      if (!n.dir) throw new IllegalStateException("not a directory");
      n = n.kids.get(p);
      if (n == null) throw new NoSuchElementException("not found");
    }
    return n;
  }

  private Node parentOf(List<String> parts) {
    if (parts.isEmpty()) throw new IllegalStateException("is a directory");
    Node p = walk(parts.subList(0, parts.size() - 1));
    if (!p.dir) throw new IllegalStateException("not a directory");
    return p;
  }

  private static String last(List<String> parts) {
    return parts.get(parts.size() - 1);
  }

  public synchronized void mkdir(String path) {
    Node n = root;
    for (String p : split(path)) {
      Node k = n.kids.get(p);
      if (k == null) {
        k = new Node(true);
        n.kids.put(p, k);
      } else if (!k.dir) throw new IllegalStateException("already exists");
      n = k;
    }
  }

  public synchronized void write(String path, String text) {
    List<String> parts = split(path);
    Node p = parentOf(parts);
    Node k = p.kids.get(last(parts));
    if (k != null && k.dir) throw new IllegalStateException("is a directory");
    Node file = new Node(false);
    file.text = text;
    p.kids.put(last(parts), file);
  }

  public synchronized void appendTo(String path, String text) {
    List<String> parts = split(path);
    Node p = parentOf(parts);
    Node k = p.kids.get(last(parts));
    if (k == null) {
      k = new Node(false);
      p.kids.put(last(parts), k);
    } else if (k.dir) throw new IllegalStateException("is a directory");
    k.text += text;
  }

  public synchronized String read(String path) {
    Node n = walk(split(path));
    if (n.dir) throw new IllegalStateException("is a directory");
    return n.text;
  }

  public synchronized List<String> ls(String path) {
    List<String> parts = split(path);
    Node n = walk(parts);
    if (!n.dir) return new ArrayList<>(List.of(last(parts)));
    return new ArrayList<>(n.kids.keySet());
  }

  public synchronized void rm(String path) {
    List<String> parts = split(path);
    Node p = parentOf(parts);
    Node k = p.kids.get(last(parts));
    if (k == null) throw new NoSuchElementException("not found");
    if (k.dir && !k.kids.isEmpty()) throw new IllegalStateException("directory not empty");
    p.kids.remove(last(parts));
  }

  // The extension round.
  public synchronized void mv(String source, String target) {
    List<String> sp = split(source);
    List<String> tp = split(target);
    if (sp.isEmpty()) throw new IllegalArgumentException("cannot move the root");
    Node n = walk(sp);
    if (tp.size() >= sp.size() && tp.subList(0, sp.size()).equals(sp))
      throw new IllegalArgumentException("cannot move into itself");
    Node tparent = parentOf(tp);
    if (tparent.kids.containsKey(last(tp))) throw new IllegalStateException("already exists");
    parentOf(sp).kids.remove(last(sp));
    tparent.kids.put(last(tp), n);
  }

  private static long total(Node n) {
    if (!n.dir) return n.text.length();
    long sum = 0;
    for (Node k : n.kids.values()) sum += total(k);
    return sum;
  }

  public synchronized long size(String path) {
    return total(walk(split(path)));
  }
}
