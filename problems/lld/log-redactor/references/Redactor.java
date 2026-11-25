import java.util.*;

public class Redactor {
  // One kind of secret: a rule rewrites the words it matches and counts them. The
  // redactor only decides which rules run and in what order.
  private interface Rule {
    long apply(String[] words);
  }

  private static final class Emails implements Rule {
    public long apply(String[] words) {
      long hits = 0;
      for (int i = 0; i < words.length; i++) {
        int at = words[i].indexOf('@');
        String domain = words[i].substring(at + 1);
        if (at > 0
            && domain.indexOf('@') < 0
            && domain.length() > 2
            && domain.substring(1, domain.length() - 1).contains(".")) {
          words[i] = "[email]";
          hits++;
        }
      }
      return hits;
    }
  }

  private static final class Cards implements Rule {
    public long apply(String[] words) {
      long hits = 0;
      for (int i = 0; i < words.length; i++) {
        String word = words[i];
        if (word.matches("[0-9]{13,19}")) {
          words[i] = "*".repeat(word.length() - 4) + word.substring(word.length() - 4);
          hits++;
        }
      }
      return hits;
    }
  }

  // Masks the word that comes right after a given word, left to right.
  private record AfterWord(String prefix, String mask) implements Rule {
    public long apply(String[] words) {
      long hits = 0;
      for (int i = 0; i + 1 < words.length; i++) {
        if (words[i].equals(prefix) && !words[i + 1].isEmpty()) {
          words[i + 1] = mask;
          hits++;
        }
      }
      return hits;
    }
  }

  private final Map<String, Rule> rules = new HashMap<>();
  private final List<String> enabled = new ArrayList<>();
  private final Map<String, Long> counts = new HashMap<>();

  public Redactor() {
    add("email", new Emails());
    add("card", new Cards());
    add("bearer", new AfterWord("Bearer", "[token]"));
  }

  private void add(String name, Rule rule) {
    rules.put(name, rule);
    counts.put(name, 0L);
  }

  private String known(String rule) {
    if (!rules.containsKey(rule)) throw new IllegalArgumentException("unknown rule");
    return rule;
  }

  public void enable(String rule) {
    if (!enabled.contains(known(rule))) enabled.add(rule);
  }

  public void disable(String rule) {
    enabled.remove(known(rule));
  }

  public String redact(String line) {
    String[] words = line.split(" ", -1);
    for (String name : enabled) counts.merge(name, rules.get(name).apply(words), Long::sum);
    return String.join(" ", words);
  }

  public long hits(String rule) {
    return counts.get(known(rule));
  }

  // The extension round: a new rule is one more entry, run like any other.
  public void maskAfter(String name, String prefix) {
    if (name.isEmpty() || rules.containsKey(name))
      throw new IllegalArgumentException("a rule needs a new, non-empty name");
    if (prefix.isEmpty() || prefix.contains(" "))
      throw new IllegalArgumentException("the prefix is one word");
    add(name, new AfterWord(prefix, "[" + name + "]"));
  }
}
