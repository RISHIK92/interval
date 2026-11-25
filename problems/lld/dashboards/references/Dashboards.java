import java.util.*;

// Queries are aggregated: panels hold only a query's name, and a query outlives every
// dashboard. Panels are composed: they live inside their dashboard's map.
public class Dashboards {
  private final Map<String, String> queries = new HashMap<>();
  private final Map<String, Map<String, String>> dashboards = new HashMap<>();

  public Dashboards() {}

  private static void named(String... names) {
    for (String n : names) if (n.isEmpty()) throw new IllegalArgumentException("names and expressions are not empty");
  }

  private Map<String, String> panels(String dashboard) {
    named(dashboard);
    Map<String, String> panels = dashboards.get(dashboard);
    if (panels == null) throw new IllegalArgumentException("unknown dashboard");
    return panels;
  }

  public void saveQuery(String name, String expr) {
    named(name, expr);
    if (queries.containsKey(name)) throw new IllegalArgumentException("query already saved");
    queries.put(name, expr);
  }

  public boolean addPanel(String dashboard, String panel, String query) {
    named(dashboard, panel, query);
    if (!queries.containsKey(query)) return false;
    Map<String, String> panels = dashboards.getOrDefault(dashboard, new HashMap<>());
    if (panels.containsKey(panel)) return false;
    panels.put(panel, query);
    dashboards.put(dashboard, panels);
    return true;
  }

  public long dropDashboard(String dashboard) {
    Map<String, String> panels = panels(dashboard);
    dashboards.remove(dashboard);
    return panels.size();
  }

  public boolean dropQuery(String name) {
    named(name);
    if (!queries.containsKey(name) || !usage(name).isEmpty()) return false;
    queries.remove(name);
    return true;
  }

  public List<String> usage(String query) {
    named(query);
    if (!queries.containsKey(query)) throw new IllegalArgumentException("unknown query");
    List<String> out = new ArrayList<>();
    for (Map.Entry<String, Map<String, String>> d : dashboards.entrySet())
      for (Map.Entry<String, String> p : d.getValue().entrySet())
        if (p.getValue().equals(query)) out.add(d.getKey() + "/" + p.getKey());
    Collections.sort(out);
    return out;
  }

  // The extension round: a copy owns new panels that share the same queries.
  public boolean duplicate(String dashboard, String newName) {
    Map<String, String> panels = panels(dashboard);
    named(newName);
    if (dashboards.containsKey(newName)) return false;
    dashboards.put(newName, new HashMap<>(panels));
    return true;
  }
}
