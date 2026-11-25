import java.util.*;
import java.util.function.LongFunction;

public class Linter {
  // One check over one line. The linter only knows this, so a new rule is a new class and an
  // entry in RULES, and no existing rule or the linter itself is edited.
  private interface Rule {
    boolean flags(String line);
  }

  private static void unused(long param) {
    if (param != 0) throw new IllegalArgumentException("this rule takes no parameter");
  }

  private static final class MaxLineLength implements Rule {
    private final long limit;

    MaxLineLength(long param) {
      if (param < 1) throw new IllegalArgumentException("a maximum is at least 1");
      limit = param;
    }

    public boolean flags(String line) {
      return line.length() > limit;
    }
  }

  private static final class NoTabs implements Rule {
    NoTabs(long param) {
      unused(param);
    }

    public boolean flags(String line) {
      return line.contains("\t");
    }
  }

  private static final class NoTrailingSpaces implements Rule {
    NoTrailingSpaces(long param) {
      unused(param);
    }

    public boolean flags(String line) {
      return line.endsWith(" ");
    }
  }

  private static final Map<String, LongFunction<Rule>> RULES =
      Map.of(
          "max-line-length", MaxLineLength::new,
          "no-tabs", NoTabs::new,
          "no-trailing-spaces", NoTrailingSpaces::new);

  // The extension round's rule: written and added without touching the ones above.
  private static final class BannedWords implements Rule {
    final Set<String> words = new HashSet<>();

    public boolean flags(String line) {
      return words.stream().anyMatch(line::contains);
    }
  }

  private final TreeMap<String, Rule> rules = new TreeMap<>();
  private BannedWords banned = null;

  public Linter() {}

  public void enable(String rule, long param) {
    LongFunction<Rule> made = RULES.get(rule);
    if (made == null) throw new IllegalArgumentException("unknown rule");
    rules.put(rule, made.apply(param));
  }

  public List<String> lint(List<String> lines) {
    List<String> out = new ArrayList<>();
    for (int i = 0; i < lines.size(); i++) {
      for (Map.Entry<String, Rule> named : rules.entrySet()) {
        if (named.getValue().flags(lines.get(i))) out.add((i + 1) + ":" + named.getKey());
      }
    }
    return out;
  }

  public List<String> enabled() {
    return new ArrayList<>(rules.keySet());
  }

  // The extension round: one more rule, added beside the others.
  public void banWord(String word) {
    if (word.isEmpty()) throw new IllegalArgumentException("empty word");
    if (banned == null) {
      banned = new BannedWords();
      rules.put("ban-word", banned);
    }
    banned.words.add(word);
  }
}
