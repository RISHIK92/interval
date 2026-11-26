import java.util.*;
import java.util.function.BiFunction;
import java.util.function.Supplier;

public class ManifestSet {
  private static final long LOAD_BALANCER = 20;
  private static final long MOST = 1_000_000;

  private interface Manifest {
    void accept(Visitor v);
  }

  private static final class Deployment implements Manifest {
    final String name;
    final long replicas;
    final Long cpu, memory;
    final boolean privileged;

    Deployment(String name, Map<String, Long> f) {
      this.name = name;
      this.replicas = f.get("replicas");
      this.cpu = f.get("cpu");
      this.memory = f.get("memory");
      this.privileged = f.getOrDefault("privileged", 0L) == 1;
    }

    public void accept(Visitor v) {
      v.deployment(this);
    }
  }

  private static final class Service implements Manifest {
    final String name;
    final long port;
    final boolean isPublic;

    Service(String name, Map<String, Long> f) {
      this.name = name;
      this.port = f.get("port");
      this.isPublic = f.getOrDefault("public", 0L) == 1;
    }

    public void accept(Visitor v) {
      v.service(this);
    }
  }

  private static final class ConfigMap implements Manifest {
    final String name;
    final long entries, secrets;

    ConfigMap(String name, Map<String, Long> f) {
      this.name = name;
      this.entries = f.get("entries");
      this.secrets = f.getOrDefault("secrets", 0L);
    }

    public void accept(Visitor v) {
      v.configmap(this);
    }
  }

  // One operation over every kind. A new operation is a new visitor; the manifest classes
  // above never change for it.
  private abstract static class Visitor {
    final List<String> lines = new ArrayList<>();

    abstract void deployment(Deployment d);

    abstract void service(Service s);

    abstract void configmap(ConfigMap c);

    List<String> finish() {
      return lines;
    }
  }

  private static final class Inventory extends Visitor {
    void deployment(Deployment d) {
      lines.add("deployment/" + d.name + " replicas=" + d.replicas);
    }

    void service(Service s) {
      lines.add("service/" + s.name + " port=" + s.port);
    }

    void configmap(ConfigMap c) {
      lines.add("configmap/" + c.name + " entries=" + c.entries);
    }
  }

  private static final class Lint extends Visitor {
    void deployment(Deployment d) {
      if (d.replicas == 1) lines.add("deployment/" + d.name + ": single replica");
      if (d.cpu == null) lines.add("deployment/" + d.name + ": no cpu limit");
    }

    void service(Service s) {
      // Nothing about a service is linted yet.
    }

    void configmap(ConfigMap c) {
      if (c.entries == 0) lines.add("configmap/" + c.name + ": empty");
    }
  }

  private static final class Cost extends Visitor {
    long total = 0;

    void add(String what, long cost) {
      lines.add(what + " " + cost);
      total += cost;
    }

    void deployment(Deployment d) {
      long cpu = d.cpu == null ? 0 : d.cpu, memory = d.memory == null ? 0 : d.memory;
      add("deployment/" + d.name, d.replicas * (cpu + memory));
    }

    void service(Service s) {
      add("service/" + s.name, s.isPublic ? LOAD_BALANCER : 0);
    }

    void configmap(ConfigMap c) {
      add("configmap/" + c.name, 0);
    }

    List<String> finish() {
      List<String> out = new ArrayList<>(lines);
      out.add("total " + total);
      return out;
    }
  }

  private static final class SecurityAudit extends Visitor {
    void deployment(Deployment d) {
      if (d.privileged) lines.add("deployment/" + d.name + ": privileged");
    }

    void service(Service s) {
      if (s.isPublic) lines.add("service/" + s.name + ": public");
    }

    void configmap(ConfigMap c) {
      if (c.secrets > 0) lines.add("configmap/" + c.name + ": plain-text secrets");
    }
  }

  private static final Map<String, Supplier<Visitor>> VISITORS =
      Map.of("inventory", Inventory::new, "lint", Lint::new, "cost", Cost::new);

  // Per kind: each field with its least and greatest value, and whether it is required.
  private record Field(long low, long high, boolean required) {}

  private record Kind(BiFunction<String, Map<String, Long>, Manifest> make, Map<String, Field> fields) {}

  private static final Field FLAG = new Field(0, 1, false);
  private static final Map<String, Kind> KINDS =
      Map.of(
          "deployment",
          new Kind(
              Deployment::new,
              Map.of(
                  "replicas", new Field(0, MOST, true),
                  "cpu", new Field(1, MOST, false),
                  "memory", new Field(1, MOST, false),
                  "privileged", FLAG)),
          "service",
          new Kind(Service::new, Map.of("port", new Field(1, 65535, true), "public", FLAG)),
          "configmap",
          new Kind(
              ConfigMap::new,
              Map.of("entries", new Field(0, MOST, true), "secrets", new Field(0, MOST, false))));

  private final List<Manifest> items = new ArrayList<>();
  private final TreeMap<String, Set<String>> names = new TreeMap<>();

  public ManifestSet() {}

  public boolean addResource(String kind, String name, Map<String, Long> fields) {
    Kind spec = KINDS.get(kind);
    if (spec == null || name.isEmpty()) throw new IllegalArgumentException("unknown kind or empty name");
    for (Map.Entry<String, Long> e : fields.entrySet()) {
      Field allowed = spec.fields().get(e.getKey());
      if (allowed == null) throw new IllegalArgumentException("unknown field");
      if (e.getValue() < allowed.low() || e.getValue() > allowed.high())
        throw new IllegalArgumentException("value out of range");
    }
    for (Map.Entry<String, Field> e : spec.fields().entrySet())
      if (e.getValue().required() && !fields.containsKey(e.getKey()))
        throw new IllegalArgumentException("missing field");
    if (!names.computeIfAbsent(kind, k -> new HashSet<>()).add(name)) return false;
    items.add(spec.make().apply(name, fields));
    return true;
  }

  public List<String> runVisitor(String visitor) {
    Supplier<Visitor> make = VISITORS.get(visitor);
    if (make == null) throw new IllegalArgumentException("unknown visitor");
    return walk(make.get());
  }

  public List<String> kinds() {
    return new ArrayList<>(names.keySet());
  }

  // The extension round: a fourth operation, and no manifest class changes.
  public List<String> securityAudit() {
    return walk(new SecurityAudit());
  }

  private List<String> walk(Visitor v) {
    for (Manifest item : items) item.accept(v);
    return v.finish();
  }
}
