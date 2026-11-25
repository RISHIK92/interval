import java.util.*;

// Each person knows their manager, and each manager knows their direct reports; the two
// sides change together. The root is the one person with no manager.
public class OrgChart {
  private String root;
  private final Map<String, String> manager = new HashMap<>();
  private final Map<String, Set<String>> reports = new HashMap<>();

  public OrgChart(String ceo) {
    named(ceo);
    root = ceo;
    manager.put(ceo, null);
    reports.put(ceo, new HashSet<>());
  }

  private static void named(String name) {
    if (name.isEmpty()) throw new IllegalArgumentException("names are not empty");
  }

  private void link(String name, String boss) {
    manager.put(name, boss);
    if (boss != null) reports.get(boss).add(name);
  }

  private void unlink(String name) {
    String boss = manager.get(name);
    if (boss != null) reports.get(boss).remove(name);
  }

  public boolean hire(String name, String boss) {
    named(name);
    named(boss);
    if (manager.containsKey(name) || !manager.containsKey(boss)) return false;
    reports.put(name, new HashSet<>());
    link(name, boss);
    return true;
  }

  public boolean reassign(String name, String boss) {
    named(name);
    named(boss);
    if (!manager.containsKey(name) || !manager.containsKey(boss) || name.equals(root)) return false;
    if (chain(boss).contains(name)) return false;
    unlink(name);
    link(name, boss);
    return true;
  }

  public boolean leave(String name) {
    named(name);
    if (!manager.containsKey(name) || name.equals(root)) return false;
    String up = manager.get(name);
    unlink(name);
    for (String report : reports.remove(name)) link(report, up);
    manager.remove(name);
    return true;
  }

  public List<String> chain(String name) {
    named(name);
    if (!manager.containsKey(name)) throw new IllegalArgumentException("unknown person");
    List<String> out = new ArrayList<>();
    for (String at = name; at != null; at = manager.get(at)) out.add(at);
    return out;
  }

  public long span(String boss) {
    named(boss);
    Set<String> r = reports.get(boss);
    if (r == null) throw new IllegalArgumentException("unknown person");
    return r.size();
  }

  // The extension round: a person swaps places with their manager.
  public boolean promote(String name) {
    named(name);
    if (!manager.containsKey(name) || name.equals(root)) return false;
    String boss = manager.get(name);
    String above = manager.get(boss);
    Set<String> theirs = new HashSet<>(reports.get(boss));
    theirs.remove(name);
    Set<String> mine = new HashSet<>(reports.get(name));
    unlink(boss);
    link(name, above);
    reports.put(name, new HashSet<>());
    reports.put(boss, new HashSet<>());
    link(boss, name);
    for (String report : theirs) link(report, name);
    for (String report : mine) link(report, boss);
    if (boss.equals(root)) root = name;
    return true;
  }
}
