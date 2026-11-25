import java.util.*;

public class ConfigSchema {
  // One check on one field's value; null when the field is absent.
  private interface Rule {
    String violation(String value);
  }

  private static final class Required implements Rule {
    public String violation(String value) {
      return value == null ? "missing" : null;
    }
  }

  private static final class IntRange implements Rule {
    private final long low, high;

    IntRange(long low, long high) {
      this.low = low;
      this.high = high;
    }

    public String violation(String value) {
      if (value == null) return null;
      if (!isInt(value)) return "not an integer";
      long n = Long.parseLong(value);
      return n < low || n > high ? "out of range" : null;
    }
  }

  private static final class OneOf implements Rule {
    private final List<String> items;

    OneOf(List<String> items) {
      this.items = items;
    }

    public String violation(String value) {
      return value == null || items.contains(value) ? null : "not allowed";
    }
  }

  private static boolean isInt(String text) {
    return text.matches("-?[0-9]{1,15}");
  }

  private static Rule parse(String spec) {
    if (spec.equals("required")) return new Required();
    int colon = spec.indexOf(':');
    String kind = colon < 0 ? spec : spec.substring(0, colon);
    String rest = colon < 0 ? "" : spec.substring(colon + 1);
    if (kind.equals("int")) {
      String[] bounds = rest.split(":", -1);
      if (bounds.length == 2 && isInt(bounds[0]) && isInt(bounds[1])) {
        long low = Long.parseLong(bounds[0]), high = Long.parseLong(bounds[1]);
        if (low <= high) return new IntRange(low, high);
      }
    } else if (kind.equals("oneOf")) {
      List<String> items = Arrays.asList(rest.split(",", -1));
      if (!items.contains("")) return new OneOf(items);
    }
    throw new IllegalArgumentException("unknown spec");
  }

  private final TreeMap<String, List<Rule>> rules = new TreeMap<>();
  private final Map<String, String> fallbacks = new HashMap<>();

  public ConfigSchema() {}

  public void rule(String field, String spec) {
    Rule parsed = parse(spec);
    if (field.isEmpty() || (parsed instanceof Required && fallbacks.containsKey(field)))
      throw new IllegalArgumentException("a field name is never empty, and this field can't take this rule");
    rules.computeIfAbsent(field, k -> new ArrayList<>()).add(parsed);
  }

  public List<String> check(Map<String, String> env) {
    List<String> out = new ArrayList<>();
    for (Map.Entry<String, List<Rule>> e : rules.entrySet()) {
      String field = e.getKey();
      String value = env.containsKey(field) ? env.get(field) : fallbacks.get(field);
      for (Rule rule : e.getValue()) {
        String problem = rule.violation(value);
        if (problem != null) out.add(field + ": " + problem);
      }
    }
    return out;
  }

  public List<String> fields() {
    return new ArrayList<>(rules.keySet());
  }

  // The extension round.
  public void fallback(String field, String value) {
    List<Rule> found = rules.getOrDefault(field, List.of());
    if (found.isEmpty() || found.stream().anyMatch(r -> r instanceof Required))
      throw new IllegalArgumentException("a fallback needs a field with rules and none required");
    fallbacks.put(field, value);
  }
}
