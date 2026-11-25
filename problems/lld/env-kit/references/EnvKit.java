import java.util.*;
import java.util.function.Function;

public class EnvKit {
  // An abstract factory: one family's way of making each kind of component. The kit only
  // ever asks the family in use, so every component it makes belongs together.
  private interface Family {
    String name();

    String queue();

    String store();

    String clock();
  }

  private static final class Local implements Family {
    public String name() {
      return "local";
    }

    public String queue() {
      return "inmem-queue";
    }

    public String store() {
      return "sqlite-store";
    }

    public String clock() {
      return "fake-clock";
    }
  }

  private static final class Ci implements Family {
    public String name() {
      return "ci";
    }

    public String queue() {
      return "valkey-queue";
    }

    public String store() {
      return "postgres-store";
    }

    public String clock() {
      return "fixed-clock";
    }
  }

  private static final class Staging implements Family {
    public String name() {
      return "staging";
    }

    public String queue() {
      return "sqs-queue";
    }

    public String store() {
      return "rds-store";
    }

    public String clock() {
      return "system-clock";
    }
  }

  // A family defined at run time: its components are named after its prefix.
  private static final class Prefixed implements Family {
    private final String name;
    private final String prefix;

    Prefixed(String name, String prefix) {
      this.name = name;
      this.prefix = prefix;
    }

    public String name() {
      return name;
    }

    public String queue() {
      return prefix + "-queue";
    }

    public String store() {
      return prefix + "-store";
    }

    public String clock() {
      return prefix + "-clock";
    }
  }

  // Each kind is one of the factory's methods; the kit never names a concrete family.
  private static final Map<String, Function<Family, String>> KINDS =
      Map.of("queue", Family::queue, "store", Family::store, "clock", Family::clock);

  private final Map<String, Family> families = new HashMap<>();
  private Family current = null;
  private final Map<String, String> made = new HashMap<>(); // component id -> family name

  public EnvKit() {
    for (Family f : List.of(new Local(), new Ci(), new Staging())) families.put(f.name(), f);
  }

  public void use(String family) {
    Family found = families.get(family);
    if (found == null) throw new IllegalArgumentException("unknown family");
    current = found;
  }

  public String component(String kind) {
    Function<Family, String> make = KINDS.get(kind);
    if (make == null) throw new IllegalArgumentException("unknown kind");
    if (current == null) throw new IllegalStateException("no family in use");
    String id = make.apply(current) + "#" + (made.size() + 1);
    made.put(id, current.name());
    return id;
  }

  public boolean wire(String a, String b) {
    if (a.equals(b)) throw new IllegalArgumentException("a component can't be wired to itself");
    return family(a).equals(family(b));
  }

  public String family(String componentId) {
    String found = made.get(componentId);
    if (found == null) throw new IllegalArgumentException("unknown component");
    return found;
  }

  // The extension round: a family that isn't built in.
  public void defineFamily(String name, String prefix) {
    if (name.isEmpty() || prefix.isEmpty()) throw new IllegalArgumentException("empty");
    if (families.containsKey(name)) throw new IllegalArgumentException("family exists");
    families.put(name, new Prefixed(name, prefix));
  }
}
