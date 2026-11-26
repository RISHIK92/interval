import java.util.*;

public class PolicyEngine {
  private static final String ANY = "*";
  private static final String USER = "{user}";
  private static final String NO_MATCH = "no-match";
  private static final String SIMULATED = "(new)";
  private static final int HOURS = 24;

  private static void checkNamed(String... names) {
    for (String name : names) if (name.isEmpty()) throw new IllegalArgumentException("an empty name");
  }

  private static int hourPart(String text) {
    if (!text.matches("[0-9]{1,2}")) throw new IllegalArgumentException("an hour is one or two digits");
    return Integer.parseInt(text);
  }

  // A resource pattern: literal characters, `*` for any run of characters, and `{user}`
  // for the requesting user's name, matched literally.
  private static final class Glob {
    private final List<String> parts = new ArrayList<>(); // each one literal character, ANY or USER

    Glob(String text) {
      String[] chunks = text.split(java.util.regex.Pattern.quote(USER), -1);
      for (int k = 0; k < chunks.length; k++) {
        if (k > 0) parts.add(USER);
        for (char c : chunks[k].toCharArray()) {
          if (c == '{' || c == '}') throw new IllegalArgumentException("a brace outside {user}");
          parts.add(String.valueOf(c));
        }
      }
    }

    boolean matches(String resource, String user) {
      // null for ANY, otherwise one literal character.
      List<Character> items = new ArrayList<>();
      for (String part : parts) {
        if (part.equals(USER)) {
          for (char c : user.toCharArray()) items.add(c);
        } else {
          items.add(part.equals(ANY) ? null : part.charAt(0));
        }
      }
      // reach[j]: the items so far can match the first j characters.
      boolean[] reach = new boolean[resource.length() + 1];
      reach[0] = true;
      for (Character item : items) {
        boolean[] next = new boolean[resource.length() + 1];
        for (int j = 0; j <= resource.length(); j++) {
          if (item == null) next[j] = reach[j] || (j > 0 && next[j - 1]);
          else next[j] = j > 0 && reach[j - 1] && resource.charAt(j - 1) == item;
        }
        reach = next;
      }
      return reach[resource.length()];
    }
  }

  // One parsed rule. A request it matches is decided by its effect.
  private static final class Policy {
    final String id;
    final String effect;
    final String role;
    final String action;
    final Glob resource;
    int[] hours = null; // from, to (not included)

    Policy(String id, String text) {
      List<String> words = new ArrayList<>();
      for (String w : text.split(" ")) if (!w.isEmpty()) words.add(w);
      if ((words.size() != 4 && words.size() != 6) || !(words.get(0).equals("allow") || words.get(0).equals("deny")))
        throw new IllegalArgumentException("effect role action resource [during from-to]");
      this.id = id;
      this.effect = words.get(0);
      this.role = words.get(1);
      this.action = words.get(2);
      this.resource = new Glob(words.get(3));
      if (words.size() == 6) {
        String[] hours = words.get(5).split("-", -1);
        if (!words.get(4).equals("during") || hours.length != 2) throw new IllegalArgumentException("during from-to");
        int start = hourPart(hours[0]), end = hourPart(hours[1]);
        if (start >= end || end > HOURS) throw new IllegalArgumentException("hours run forward, up to 24");
        this.hours = new int[] {start, end};
      }
    }

    boolean matches(String user, List<String> roles, String action, String resource, long hour) {
      return (role.equals(ANY) || roles.contains(role))
          && (this.action.equals(ANY) || this.action.equals(action))
          && (hours == null || (hours[0] <= hour && hour < hours[1]))
          && this.resource.matches(resource, user);
    }
  }

  private List<Policy> policies = new ArrayList<>();

  public boolean addPolicy(String id, String text) {
    checkNamed(id);
    Policy policy = new Policy(id, text);
    for (Policy p : policies) if (p.id.equals(id)) return false;
    policies.add(policy);
    return true;
  }

  public boolean removePolicy(String id) {
    checkNamed(id);
    return policies.removeIf(p -> p.id.equals(id));
  }

  public String decide(String user, List<String> roles, String action, String resource, long hour) {
    return decideWith(policies, user, roles, action, resource, hour);
  }

  // The extension round: a decision as if one more policy existed.
  public String simulate(String text, String user, List<String> roles, String action, String resource, long hour) {
    List<Policy> all = new ArrayList<>(policies);
    all.add(new Policy(SIMULATED, text));
    return decideWith(all, user, roles, action, resource, hour);
  }

  private static String decideWith(
      List<Policy> policies, String user, List<String> roles, String action, String resource, long hour) {
    checkNamed(user, action, resource);
    for (String role : roles) checkNamed(role);
    if (hour < 0 || hour >= HOURS) throw new IllegalArgumentException("an hour runs from 0 to 23");
    // A chain of responsibility in two passes: any deny that matches decides first, then
    // the earliest allow; with neither, the request falls off the chain.
    for (String effect : List.of("deny", "allow"))
      for (Policy p : policies)
        if (p.effect.equals(effect) && p.matches(user, roles, action, resource, hour)) return effect + ":" + p.id;
    return NO_MATCH;
  }
}
