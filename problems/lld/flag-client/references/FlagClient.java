import java.util.*;
import java.util.function.Function;

public class FlagClient {
  private static String filled(String text) {
    if (text.isEmpty()) throw new IllegalArgumentException("empty");
    return text;
  }

  // The user's bucket for this flag, 0 to 99: a hash, so it's stable across calls and
  // clients, and different flags split users differently.
  private static long bucket(String flag, String user) {
    long h = 0;
    for (char c : (flag + ":" + user).toCharArray()) h = (h * 31 + c) % 1000003;
    return h % 100;
  }

  // The adapter side: each rule string from the server becomes a small rule object.
  private interface Rule {
    boolean matches(String flag, String user, Map<String, String> attrs);
  }

  private record UserRule(String name) implements Rule {
    UserRule {
      filled(name);
    }

    public boolean matches(String flag, String user, Map<String, String> attrs) {
      return user.equals(name);
    }
  }

  private record AttrRule(String key, String value) implements Rule {
    AttrRule {
      filled(key);
      filled(value);
    }

    static AttrRule of(String text) {
      int eq = text.indexOf('=');
      if (eq < 0) throw new IllegalArgumentException("attr:<key>=<value>");
      return new AttrRule(text.substring(0, eq), text.substring(eq + 1));
    }

    public boolean matches(String flag, String user, Map<String, String> attrs) {
      return value.equals(attrs.get(key));
    }
  }

  private record PercentRule(long percent) implements Rule {
    static PercentRule of(String text) {
      if (text.isEmpty() || text.length() > 3 || (text.charAt(0) == '0' && !text.equals("0")))
        throw new IllegalArgumentException("0 to 100");
      for (char c : text.toCharArray()) if (c < '0' || c > '9') throw new IllegalArgumentException("0 to 100");
      long n = Long.parseLong(text);
      if (n > 100) throw new IllegalArgumentException("0 to 100");
      return new PercentRule(n);
    }

    public boolean matches(String flag, String user, Map<String, String> attrs) {
      return bucket(flag, user) < percent;
    }
  }

  private static final Map<String, Function<String, Rule>> RULES =
      Map.of("user", UserRule::new, "attr", AttrRule::of, "percent", PercentRule::of);

  private static Rule parseRule(String text) {
    int colon = text.indexOf(':');
    // A rule without a ":" leaves nothing for the rule itself, and every rule needs it.
    Function<String, Rule> make = RULES.get(colon < 0 ? text : text.substring(0, colon));
    if (make == null) throw new IllegalArgumentException("an unknown rule");
    return make.apply(colon < 0 ? "" : text.substring(colon + 1));
  }

  private record Published(List<Rule> rules, long version) {}

  // The facade: evaluate hides fetching, the local copy of the rules (a proxy for the flag
  // server) and the rule types. Until a sync reaches the server it answers with the
  // defaults; while the server is down it keeps answering from its last copy.
  private final Map<String, Boolean> defaults;
  private final Map<String, Published> server = new HashMap<>();
  private Map<String, List<Rule>> copy = new HashMap<>();
  private Long syncedAt = null;
  private final Map<String, Boolean> overrides = new HashMap<>();

  public FlagClient(Map<String, Boolean> defaults) {
    for (String flag : defaults.keySet()) filled(flag);
    this.defaults = new HashMap<>(defaults);
  }

  public void serverRules(String flag, List<String> rules, long version) {
    filled(flag);
    if (version < 1) throw new IllegalArgumentException("versions start at 1");
    List<Rule> parsed = new ArrayList<>();
    for (String text : rules) parsed.add(parseRule(text));
    Published current = server.get(flag);
    if (current == null || version > current.version()) server.put(flag, new Published(parsed, version));
  }

  public boolean sync(long nowMs, boolean reachable) {
    if (!reachable) return false;
    copy = new HashMap<>();
    for (Map.Entry<String, Published> e : server.entrySet()) copy.put(e.getKey(), e.getValue().rules());
    syncedAt = nowMs;
    return true;
  }

  public boolean evaluate(String flag, String user, Map<String, String> attrs) {
    filled(flag);
    filled(user);
    if (overrides.containsKey(flag)) return overrides.get(flag);
    List<Rule> rules = copy.get(flag);
    if (rules != null) {
      for (Rule rule : rules) if (rule.matches(flag, user, attrs)) return true;
      return false;
    }
    Boolean fallback = defaults.get(flag);
    if (fallback == null) throw new NoSuchElementException("no rules and no default");
    return fallback;
  }

  public long staleMs(long nowMs) {
    if (syncedAt == null) throw new IllegalStateException("never synced");
    return nowMs - syncedAt;
  }

  // The extension round: a local override wins over everything else.
  public void localOverride(String flag, boolean on) {
    overrides.put(filled(flag), on);
  }
}
